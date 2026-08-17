import { invoke } from "@tauri-apps/api/core";
import { toSourceId } from "../loop/actions";
import { normalizeUrl, type FetchedPage, type ToolPort } from "../loop/researchLoop";
import { raceAgainstSignal, type FsToolPortState } from "./shared";

export function createReadPdf(state: FsToolPortState, timeoutMs: number): ToolPort["readPdf"] {
  return async (url, signal) => {
    const fetched = await raceAgainstSignal(
      () => invoke<FetchedPage>("research_read_pdf", { url, timeoutMs }),
      signal,
    );

    // Mirrors dispatchTool's `S${state.sources.length + 1}` id assignment — see shared.ts.
    // Shares the SAME counter as openUrl: the loop's sources[] array is one array across
    // both tools, so this MUST be constructed against the same FsToolPortState instance.
    const assumedId = toSourceId(`S${state.nextOrdinal}`);
    state.nextOrdinal += 1;
    state.bodies.set(assumedId, { url: normalizeUrl(url), body: fetched.body });

    return fetched;
  };
}
