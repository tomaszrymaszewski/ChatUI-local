import { describe, it, expect } from "vitest";
import { compareSources } from "./compareSources";
import { toSourceId } from "../loop/actions";

describe("compareSources", () => {
  it("returns ranked snippets per source id", () => {
    const s1 = toSourceId("S1");
    const s2 = toSourceId("S2");
    const bodies = new Map([
      [s1, "the company reported revenue of $10 million this quarter"],
      [s2, "the company reported revenue of $15 million this quarter"],
    ]);

    const result = compareSources("revenue this quarter", [s1, s2], bodies);

    expect(result[s1].length).toBeGreaterThan(0);
    expect(result[s2].length).toBeGreaterThan(0);
  });

  it("returns an empty array (not an error) for a source with no known body", () => {
    const s1 = toSourceId("S1");
    const bodies = new Map<ReturnType<typeof toSourceId>, string>();

    const result = compareSources("claim", [s1], bodies);

    expect(result[s1]).toEqual([]);
  });

  it("handles an empty source id list", () => {
    const result = compareSources("claim", [], new Map());
    expect(result).toEqual({});
  });
});
