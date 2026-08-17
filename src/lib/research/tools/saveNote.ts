import { invoke } from "@tauri-apps/api/core";
import type { Result, SourceId, SubQuestionId } from "../loop/actions";
import { toFindingId, type FindingId } from "../loop/researchLoop";

export interface SaveNoteFinding {
  readonly text: string;
  readonly sourceIds: readonly SourceId[];
  readonly tags: readonly string[];
  readonly targetsSubQ: SubQuestionId | null;
}

export interface SaveNoteResult {
  readonly findingId: FindingId;
  readonly path: string;
}

/**
 * Standalone persistence/validation helper — NOT wired into the loop's dispatchTool in this
 * stage (folding a finding into ResearchSession already happens there, unchanged; this is a
 * separate, disconnected durability concern). Reuses the app's existing generic fs commands
 * (write_text_file already mkdir -p's the parent) rather than adding any new Rust code.
 *
 * Uses Result<T,E> (unlike the ToolPort methods) since it isn't constrained by a frozen
 * Promise<T> interface — consistent with the "errors as values" convention from actions.ts.
 */
export async function saveNote(
  finding: SaveNoteFinding,
  sessionId: string,
  existingSourceIds: ReadonlySet<SourceId>,
): Promise<Result<SaveNoteResult, string>> {
  if (finding.text.trim().length === 0) {
    return { ok: false, error: "save_note requires non-empty text" };
  }

  for (const id of finding.sourceIds) {
    if (!existingSourceIds.has(id)) {
      return { ok: false, error: `unknown source id: ${id}` };
    }
  }

  const findingId = toFindingId(`note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const record = { id: findingId, ...finding, createdAt: Date.now() };

  try {
    const base = await invoke<string>("ensure_chat_ui_directory");
    const path = `${base}/research/${sessionId}/findings/${findingId}.json`;
    await invoke("write_text_file", { path, content: JSON.stringify(record, null, 2) });
    return { ok: true, value: { findingId, path } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "failed to save note" };
  }
}
