import type { SourceId } from "../loop/actions";
import { rankSnippets } from "./searchInPage";

/**
 * Standalone evidence-gathering helper — NOT wired into the loop's dispatchTool in this stage
 * (that would mean touching researchLoop.ts, which is out of scope; see Stage-2 plan). Ready
 * for a future wiring stage to give the model pre-gathered evidence for a claim across several
 * sources in one call, instead of N separate search_in_page calls.
 *
 * Total function (never throws): a missing body for a given id yields no evidence (empty
 * array), not an error — this isn't constrained by a Promise<T>/Result<T,E> boundary.
 */
export function compareSources(
  claim: string,
  sourceIds: readonly SourceId[],
  bodies: ReadonlyMap<SourceId, string>,
): Record<SourceId, readonly string[]> {
  const result = {} as Record<SourceId, readonly string[]>;
  for (const id of sourceIds) {
    const body = bodies.get(id);
    result[id] = body ? rankSnippets(body, claim) : [];
  }
  return result;
}
