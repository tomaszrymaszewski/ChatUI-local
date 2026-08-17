export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function assertNever(value: never, context?: string): never {
  throw new Error(`Unreachable case${context ? ` (${context})` : ""}: ${JSON.stringify(value)}`);
}

export type SourceId = string & { readonly __brand: "SourceId" };
export type SubQuestionId = string & { readonly __brand: "SubQuestionId" };

export function toSourceId(raw: string): SourceId {
  return raw as SourceId;
}

export function toSubQuestionId(raw: string): SubQuestionId {
  return raw as SubQuestionId;
}

export const ACTION_NAMES = [
  "web_search",
  "open_url",
  "read_pdf",
  "search_in_page",
  "save_note",
  "compare_sources",
  "calculate",
  "reflect",
  "write_answer",
] as const;

export type ActionName = (typeof ACTION_NAMES)[number];

export interface WebSearchArgs {
  readonly query: string;
}
export interface OpenUrlArgs {
  readonly url: string;
}
export interface ReadPdfArgs {
  readonly url: string;
}
export interface SearchInPageArgs {
  readonly sourceId: SourceId;
  readonly query: string;
}
export interface SaveNoteArgs {
  readonly text: string;
  readonly sourceIds: readonly SourceId[];
  readonly tags: readonly string[];
  readonly subqStatus?: "partial" | "done";
}
export interface CompareSourcesArgs {
  readonly subject: string;
  readonly sourceIds: readonly SourceId[];
  readonly summary: string;
  readonly conflict: boolean;
}
export interface CalculateArgs {
  readonly expression: string;
}
export interface ReflectArgs {
  readonly reason?: string;
}
export interface WriteAnswerArgs {
  readonly summary: string;
}

interface ActionEnvelope<TName extends ActionName, TArgs> {
  readonly thought: string;
  readonly action: TName;
  readonly args: TArgs;
  readonly targetsSubQ: SubQuestionId | null;
  readonly confidence: number;
}

export type ModelAction =
  | ActionEnvelope<"web_search", WebSearchArgs>
  | ActionEnvelope<"open_url", OpenUrlArgs>
  | ActionEnvelope<"read_pdf", ReadPdfArgs>
  | ActionEnvelope<"search_in_page", SearchInPageArgs>
  | ActionEnvelope<"save_note", SaveNoteArgs>
  | ActionEnvelope<"compare_sources", CompareSourcesArgs>
  | ActionEnvelope<"calculate", CalculateArgs>
  | ActionEnvelope<"reflect", ReflectArgs>
  | ActionEnvelope<"write_answer", WriteAnswerArgs>;

export type ActionError =
  | { readonly kind: "invalid_json"; readonly message: string }
  | { readonly kind: "schema_invalid"; readonly message: string }
  | { readonly kind: "unknown_source"; readonly sourceId: string }
  | { readonly kind: "unknown_subq"; readonly subQuestionId: string };

const CORRECTIVE_SUFFIX = "Reply again with ONLY a valid JSON action.";

export function describeActionError(error: ActionError): string {
  switch (error.kind) {
    case "invalid_json":
      return `Your last output was not valid JSON (${error.message}). ${CORRECTIVE_SUFFIX}`;
    case "schema_invalid":
      return `Your last output did not match the required action schema (${error.message}). ${CORRECTIVE_SUFFIX}`;
    case "unknown_source":
      return `Your last output referenced an unknown source id "${error.sourceId}". ${CORRECTIVE_SUFFIX}`;
    case "unknown_subq":
      return `Your last output referenced an unknown sub-question id "${error.subQuestionId}". ${CORRECTIVE_SUFFIX}`;
    default:
      return assertNever(error, "describeActionError");
  }
}

export interface ValidationContext {
  readonly existingSourceIds: ReadonlySet<SourceId>;
  readonly existingSubQuestionIds: ReadonlySet<SubQuestionId>;
}

const FENCE_PATTERN = /```(?:json)?\s*([\s\S]*?)```/;

export function extractFirstJsonObject(raw: string): Result<string, ActionError> {
  const fenceMatch = FENCE_PATTERN.exec(raw);
  const searchSpace = fenceMatch ? fenceMatch[1] : raw;

  const start = searchSpace.indexOf("{");
  if (start === -1) {
    return err({ kind: "invalid_json", message: "no opening brace found" });
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < searchSpace.length; i++) {
    const char = searchSpace[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        return ok(searchSpace.slice(start, i + 1));
      }
    }
  }

  return err({ kind: "invalid_json", message: "unbalanced braces" });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

interface ArgValidation<TArgs> {
  readonly validate: (args: Record<string, unknown>) => Result<TArgs, string>;
}

const argValidators: { [K in ActionName]: ArgValidation<unknown> } = {
  web_search: {
    validate: (a) =>
      isNonEmptyString(a.query) ? ok<WebSearchArgs>({ query: a.query }) : err("web_search requires a non-empty string 'query'"),
  },
  open_url: {
    validate: (a) => (isNonEmptyString(a.url) ? ok<OpenUrlArgs>({ url: a.url }) : err("open_url requires a non-empty string 'url'")),
  },
  read_pdf: {
    validate: (a) => (isNonEmptyString(a.url) ? ok<ReadPdfArgs>({ url: a.url }) : err("read_pdf requires a non-empty string 'url'")),
  },
  search_in_page: {
    validate: (a) =>
      isNonEmptyString(a.source_id) && isNonEmptyString(a.query)
        ? ok<SearchInPageArgs>({ sourceId: toSourceId(a.source_id), query: a.query })
        : err("search_in_page requires string 'source_id' and 'query'"),
  },
  save_note: {
    validate: (a) => {
      if (!isNonEmptyString(a.text)) return err("save_note requires a non-empty string 'text'");
      if (!isStringArray(a.source_ids)) return err("save_note requires a string array 'source_ids'");
      if (!isStringArray(a.tags)) return err("save_note requires a string array 'tags'");
      if (a.subq_status !== undefined && a.subq_status !== "partial" && a.subq_status !== "done") {
        return err("save_note 'subq_status' must be 'partial' or 'done' when present");
      }
      const args: SaveNoteArgs = {
        text: a.text,
        sourceIds: a.source_ids.map(toSourceId),
        tags: a.tags,
        subqStatus: a.subq_status as "partial" | "done" | undefined,
      };
      return ok(args);
    },
  },
  compare_sources: {
    validate: (a) => {
      if (!isNonEmptyString(a.subject)) return err("compare_sources requires a non-empty string 'subject'");
      if (!isStringArray(a.source_ids)) return err("compare_sources requires a string array 'source_ids'");
      if (!isNonEmptyString(a.summary)) return err("compare_sources requires a non-empty string 'summary'");
      if (typeof a.conflict !== "boolean") return err("compare_sources requires a boolean 'conflict'");
      const args: CompareSourcesArgs = {
        subject: a.subject,
        sourceIds: a.source_ids.map(toSourceId),
        summary: a.summary,
        conflict: a.conflict,
      };
      return ok(args);
    },
  },
  calculate: {
    validate: (a) => (isNonEmptyString(a.expression) ? ok<CalculateArgs>({ expression: a.expression }) : err("calculate requires a non-empty string 'expression'")),
  },
  reflect: {
    validate: (a) => {
      if (a.reason !== undefined && typeof a.reason !== "string") return err("reflect 'reason' must be a string when present");
      const args: ReflectArgs = { reason: a.reason as string | undefined };
      return ok(args);
    },
  },
  write_answer: {
    validate: (a) => (isNonEmptyString(a.summary) ? ok<WriteAnswerArgs>({ summary: a.summary }) : err("write_answer requires a non-empty string 'summary'")),
  },
};

function isActionName(value: unknown): value is ActionName {
  return typeof value === "string" && (ACTION_NAMES as readonly string[]).includes(value);
}

export function parseAndValidateAction(raw: string, context: ValidationContext): Result<ModelAction, ActionError> {
  const extracted = extractFirstJsonObject(raw);
  if (!extracted.ok) return extracted;

  let parsed: unknown;
  try {
    parsed = JSON.parse(extracted.value);
  } catch (parseError) {
    return err({ kind: "invalid_json", message: parseError instanceof Error ? parseError.message : "JSON.parse failed" });
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return err({ kind: "schema_invalid", message: "top-level value must be a JSON object" });
  }

  const record = parsed as Record<string, unknown>;

  if (!isNonEmptyString(record.thought)) {
    return err({ kind: "schema_invalid", message: "'thought' must be a non-empty string" });
  }
  if (!isActionName(record.action)) {
    return err({ kind: "schema_invalid", message: `'action' must be one of ${ACTION_NAMES.join(", ")}` });
  }
  if (typeof record.confidence !== "number" || record.confidence < 0 || record.confidence > 1) {
    return err({ kind: "schema_invalid", message: "'confidence' must be a number between 0 and 1" });
  }
  if (record.targets_subq !== null && !isNonEmptyString(record.targets_subq)) {
    return err({ kind: "schema_invalid", message: "'targets_subq' must be a string or null" });
  }
  if (typeof record.args !== "object" || record.args === null || Array.isArray(record.args)) {
    return err({ kind: "schema_invalid", message: "'args' must be a JSON object" });
  }

  const actionName = record.action;
  const argsRecord = record.args as Record<string, unknown>;
  const argsResult = argValidators[actionName].validate(argsRecord);
  if (!argsResult.ok) {
    return err({ kind: "schema_invalid", message: argsResult.error });
  }

  const targetsSubQ = record.targets_subq === null ? null : toSubQuestionId(record.targets_subq);
  if (targetsSubQ !== null && !context.existingSubQuestionIds.has(targetsSubQ)) {
    return err({ kind: "unknown_subq", subQuestionId: targetsSubQ });
  }

  const sourceIdCheck = checkReferencedSourceIds(actionName, argsResult.value, context);
  if (sourceIdCheck) return err(sourceIdCheck);

  return ok({
    thought: record.thought,
    action: actionName,
    args: argsResult.value,
    targetsSubQ,
    confidence: record.confidence,
  } as ModelAction);
}

function checkReferencedSourceIds(actionName: ActionName, args: unknown, context: ValidationContext): ActionError | null {
  const idsToCheck: SourceId[] = [];

  switch (actionName) {
    case "search_in_page":
      idsToCheck.push((args as SearchInPageArgs).sourceId);
      break;
    case "save_note":
      idsToCheck.push(...(args as SaveNoteArgs).sourceIds);
      break;
    case "compare_sources":
      idsToCheck.push(...(args as CompareSourcesArgs).sourceIds);
      break;
    case "web_search":
    case "open_url":
    case "read_pdf":
    case "calculate":
    case "reflect":
    case "write_answer":
      break;
    default:
      return assertNever(actionName, "checkReferencedSourceIds");
  }

  for (const id of idsToCheck) {
    if (!context.existingSourceIds.has(id)) {
      return { kind: "unknown_source", sourceId: id };
    }
  }
  return null;
}
