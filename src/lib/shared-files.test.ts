import { describe, expect, it } from "vitest";
import { mergeSessionFiles } from "@/lib/shared-files";
import type { ActivityItem } from "@/lib/agent/types";

function trace(path: string, name: string, bytes?: number): ActivityItem {
  return {
    id: `tool-${path}`,
    kind: "tool",
    name: "write_local_file",
    status: "done",
    file: { path, name, ...(bytes !== undefined ? { bytes } : {}) },
  };
}

describe("mergeSessionFiles", () => {
  it("merges the same path into one row with the known size winning", () => {
    const out = mergeSessionFiles([
      { shares: [{ path: "/a/report.docx", name: "report.docx" }], activities: [] },
      { shares: [], activities: [trace("/a/report.docx", "report.docx", 120)] },
    ]);
    expect(out).toEqual([{ path: "/a/report.docx", name: "report.docx", size: 120 }]);
  });

  it("drops a stale activity trace when the same name was shared from another path", () => {
    const out = mergeSessionFiles([
      {
        shares: [{ path: "/Users/me/Documents/report.docx", name: "report.docx" }],
        activities: [trace("~/Documents/report.docx", "report.docx", 0)],
      },
    ]);
    expect(out).toEqual([{ path: "/Users/me/Documents/report.docx", name: "report.docx" }]);
  });

  it("keeps an activity trace that is the only record of its file", () => {
    const out = mergeSessionFiles([
      { shares: [], activities: [trace("/tmp/notes.txt", "notes.txt", 40)] },
    ]);
    expect(out).toEqual([{ path: "/tmp/notes.txt", name: "notes.txt", size: 40 }]);
  });

  it("ignores error-status traces", () => {
    const failed: ActivityItem = { ...trace("/tmp/x.txt", "x.txt", 10), status: "error" };
    expect(mergeSessionFiles([{ shares: [], activities: [failed] }])).toEqual([]);
  });

  it("keeps two genuinely different shared files that happen to share a name", () => {
    const out = mergeSessionFiles([
      {
        shares: [
          { path: "/a/report.docx", name: "report.docx" },
          { path: "/b/report.docx", name: "report.docx" },
        ],
        activities: [],
      },
    ]);
    expect(out).toHaveLength(2);
  });
});
