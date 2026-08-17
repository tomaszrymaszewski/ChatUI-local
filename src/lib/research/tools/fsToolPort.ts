import { TOOL_TIMEOUT_MS, type ToolPort, type WebSearchHit } from "../loop/researchLoop";
import { createFsToolPortState } from "./shared";
import { createOpenUrl } from "./openUrl";
import { createReadPdf } from "./readPdf";
import { createSearchInPage } from "./searchInPage";

export interface CreateFsToolPortOptions {
  /** Defaults to TOOL_TIMEOUT_MS. The frozen ToolPort.openUrl(url, signal) signature has no
   *  channel for a numeric timeout, so this is passed explicitly at construction — a future
   *  wiring stage can pass config.toolTimeoutMs here to keep the JS-side race and the Rust-side
   *  reqwest timeout numerically identical by construction. */
  readonly timeoutMs?: number;
  /** web_search is out of scope for this stage (upload-grounded URLs/PDFs only). Defaults to a
   *  stub that throws — never a silent [], which could read as "searched, found nothing" and
   *  mislead the model. */
  readonly webSearch?: ToolPort["webSearch"];
}

export function createFsToolPort(options: CreateFsToolPortOptions = {}): ToolPort {
  const state = createFsToolPortState();
  const timeoutMs = options.timeoutMs ?? TOOL_TIMEOUT_MS;

  return {
    webSearch: options.webSearch ?? unimplementedWebSearch,
    openUrl: createOpenUrl(state, timeoutMs),
    readPdf: createReadPdf(state, timeoutMs),
    searchInPage: createSearchInPage(state),
  };
}

async function unimplementedWebSearch(_query: string, _signal: AbortSignal): Promise<readonly WebSearchHit[]> {
  throw new Error("web_search is not implemented in this stage (upload-grounded URLs/PDFs only — see Stage 2 scope)");
}
