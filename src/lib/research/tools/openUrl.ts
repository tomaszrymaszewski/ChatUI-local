import { invoke } from "@tauri-apps/api/core";
import { toSourceId } from "../loop/actions";
import { normalizeUrl, type FetchedPage, type ToolPort } from "../loop/researchLoop";
import { raceAgainstSignal, type FsToolPortState } from "./shared";

export function createOpenUrl(state: FsToolPortState, timeoutMs: number): ToolPort["openUrl"] {
  return async (url, signal) => {
    const fetched = await raceAgainstSignal(
      () => invoke<FetchedPage>("research_open_url", { url, timeoutMs }),
      signal,
    );

    // Mirrors dispatchTool's `S${state.sources.length + 1}` id assignment — see shared.ts.
    const assumedId = toSourceId(`S${state.nextOrdinal}`);
    state.nextOrdinal += 1;
    state.bodies.set(assumedId, { url: normalizeUrl(url), body: fetched.body });

    return fetched;
  };
}
