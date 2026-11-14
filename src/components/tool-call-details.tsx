import { Fragment, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ActivityItem } from "@/lib/agent/types";
import {
  buildToolView,
  parseLooseJson,
  toDetailRows,
  type DetailRow,
  type RunOutput,
} from "@/lib/tool-display";
import { cn } from "@/lib/utils";

/** Text longer than this (characters or lines) collapses behind "Show more". */
const CLAMP_CHARS = 420;
const CLAMP_LINES = 8;

/**
 * Expanded body of a tool-call chip. Facts (file, query, arguments) show as
 * labelled rows, code or file content sits behind a toggle, and the result is
 * text or rows. JSON never reaches the UI; see lib/tool-display.ts.
 */
export function ToolCallDetails({ item }: { item: ActivityItem }) {
  const view = buildToolView(item);
  const failed = item.status === "error";
  const resultRows = view.resultRows ?? [];
  const hasContent =
    view.facts.length > 0 ||
    !!view.command ||
    !!view.body ||
    !!view.run ||
    resultRows.length > 0 ||
    !!view.resultText;
  if (!hasContent) return null;

  return (
    <div
      className={cn(
        "flex flex-col gap-2.5 rounded-lg border bg-muted/20 px-3 py-2.5 text-xs",
        failed && "border-red-500/30",
      )}
    >
      {view.facts.length > 0 && <FactList rows={view.facts} />}
      {view.command && (
        <div className="rounded-md bg-background/60 px-2.5 py-2">
          <ClampedText text={view.command} mono />
        </div>
      )}
      {view.body && (
        <Disclosure label={`${view.body.label} · ${pluralLines(view.body.text)}`}>
          <div className="rounded-md bg-background/60 p-2.5">
            <ClampedText text={view.body.text} mono />
          </div>
        </Disclosure>
      )}
      {view.run && <RunResult run={view.run} />}
      {!view.run && resultRows.length > 0 && (
        <div className="border-t pt-2.5">
          <FactList rows={resultRows} />
        </div>
      )}
      {!view.run && view.resultText && (
        <div className={cn("border-t pt-2.5", failed ? "text-red-500" : "text-muted-foreground")}>
          <ClampedText text={view.resultText} />
        </div>
      )}
    </div>
  );
}

function pluralLines(text: string): string {
  const count = text.split("\n").length;
  return `${count} ${count === 1 ? "line" : "lines"}`;
}

function FactList({ rows, nested = false }: { rows: DetailRow[]; nested?: boolean }) {
  return (
    <dl
      className={cn(
        "grid grid-cols-[max-content_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1.5",
        nested && "border-l pl-3",
      )}
    >
      {rows.map((row, index) => (
        <Fragment key={`${index}-${row.label}`}>
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className="min-w-0 break-words">
            {row.rows ? (
              <FactList rows={row.rows} nested />
            ) : (
              <ClampedText text={row.text ?? "—"} />
            )}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

function clampText(text: string): string {
  const byLines = text.split("\n").slice(0, CLAMP_LINES).join("\n");
  const limited = byLines.length > CLAMP_CHARS ? byLines.slice(0, CLAMP_CHARS) : byLines;
  return `${limited.trimEnd()}…`;
}

function ClampedText({ text, mono = false }: { text: string; mono?: boolean }) {
  const [open, setOpen] = useState(false);
  const long = text.length > CLAMP_CHARS || text.split("\n").length > CLAMP_LINES;
  return (
    <div
      className={cn(
        "min-w-0 whitespace-pre-wrap break-words",
        mono && "font-mono text-[11px] leading-relaxed",
      )}
    >
      {long && !open ? clampText(text) : text}
      {long && (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="ml-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
      >
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        {label}
      </button>
      {open && <div className="mt-1.5">{children}</div>}
    </div>
  );
}

function RunResult({ run }: { run: RunOutput }) {
  const facts: DetailRow[] = [];
  if (run.exitCode !== undefined) facts.push({ label: "Exit code", text: run.exitCode });
  if (run.workingDir) facts.push({ label: "Folder", text: run.workingDir });
  if (run.timedOut) facts.push({ label: "Status", text: "Timed out" });
  return (
    <div className="flex flex-col gap-2.5 border-t pt-2.5">
      {facts.length > 0 && <FactList rows={facts} />}
      {run.stdout && <OutputBlock label="Output" text={run.stdout} />}
      {run.stderr && <OutputBlock label="Errors" text={run.stderr} error />}
      {run.other && (
        <div className="text-muted-foreground">
          <ClampedText text={run.other} />
        </div>
      )}
    </div>
  );
}

/** A stdout or stderr section: JSON output becomes rows, anything else stays text. */
function OutputBlock({ label, text, error = false }: { label: string; text: string; error?: boolean }) {
  const structured = parseLooseJson(text);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      {structured !== undefined ? (
        <FactList rows={toDetailRows(structured)} />
      ) : (
        <div
          className={cn(
            "rounded-md bg-background/60 p-2.5",
            error ? "text-red-500/90" : "text-muted-foreground",
          )}
        >
          <ClampedText text={text} mono />
        </div>
      )}
    </div>
  );
}
