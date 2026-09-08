import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  buildRunDigest,
  estimateMessageTokens,
  MAX_HISTORY_TOKENS,
  resolveHistoryBudget,
  toHistoryMessage,
  truncateMessagesToBudget,
} from "./history";
import type { AgentMessage } from "./runtime";
import type { Message, Provider } from "@/types";

vi.mock("@/lib/model-capabilities", () => ({ getModelContextWindow: vi.fn() }));

import { getModelContextWindow } from "@/lib/model-capabilities";

const mockedContextWindow = vi.mocked(getModelContextWindow);

const provider = (baseUrl: string): Provider => ({
  id: "p1",
  name: "Test",
  baseUrl,
  models: [],
  hasKey: true,
});

beforeEach(() => {
  vi.clearAllMocks();
});

const msg = (chars: number) => ({ role: "user" as const, content: "x".repeat(chars) });

const storedMsg = (over: Partial<Message>): Message => ({
  id: "m1",
  role: "assistant",
  content: "summary",
  timestamp: new Date(),
  ...over,
});

describe("estimateMessageTokens", () => {
  it("estimates ~4 chars per token plus overhead", () => {
    expect(estimateMessageTokens({ content: "x".repeat(400) })).toBe(104);
  });

  it("counts image parts at a fixed cost", () => {
    const t = estimateMessageTokens({
      content: [
        { type: "text", text: "hi" },
        { type: "image_url", image_url: { url: "data:..." } },
      ],
    });
    expect(t).toBe(1105); // 4 + 1 + 1100
  });
});

describe("truncateMessagesToBudget", () => {
  it("keeps everything when under budget", () => {
    const messages = [msg(40), msg(40), msg(40)];
    expect(truncateMessagesToBudget(messages, 1000)).toHaveLength(3);
  });

  it("drops the oldest messages first", () => {
    const messages = [
      { role: "user" as const, content: "oldest" },
      { role: "assistant" as const, content: "middle" },
      { role: "user" as const, content: "newest" },
    ];
    // each ~6 tokens; budget 8 keeps only the newest two
    const out = truncateMessagesToBudget(messages, 8);
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe("newest");
  });

  it("always keeps the latest message even over budget", () => {
    const messages = [msg(10000)];
    expect(truncateMessagesToBudget(messages, 100)).toHaveLength(1);
  });

  it("handles empty history", () => {
    expect(truncateMessagesToBudget([], 100)).toHaveLength(0);
  });

  it("folds assistant run metadata into the replayed content", () => {
    const messages: AgentMessage[] = [
      {
        role: "assistant",
        content: "summary",
        meta: {
          activities: [
            {
              id: "researcher-0",
              kind: "subagent",
              name: "Research: topic",
              status: "done",
              output: "y".repeat(8000),
            },
          ],
        },
      },
      { role: "user", content: "continue" },
    ];
    const out = truncateMessagesToBudget(messages, 5000);
    expect(out).toHaveLength(2);
    expect(String(out[0].content)).toContain("summary");
    expect(String(out[0].content)).toContain("Sub-agent findings:");
    expect(String(out[0].content)).toContain("y".repeat(100));
  });

  it("falls back to the plain assistant message when the digest does not fit", () => {
    const messages: AgentMessage[] = [
      {
        role: "assistant",
        content: "summary",
        meta: {
          activities: [
            {
              id: "researcher-0",
              kind: "subagent",
              name: "Research: topic",
              status: "done",
              output: "y".repeat(8000),
            },
          ],
        },
      },
      { role: "user", content: "continue" },
    ];
    // expanded assistant is ~1.6k tokens; plain is ~6 — budget only fits the plain one
    const out = truncateMessagesToBudget(messages, 200);
    expect(out).toHaveLength(2);
    expect(out[0].content).toBe("summary");
  });

  it("drops the assistant message entirely when even the plain form does not fit", () => {
    const messages: AgentMessage[] = [
      { role: "assistant", content: "z".repeat(4000), meta: { reasoning: "thought" } },
      { role: "user", content: "continue" },
    ];
    const out = truncateMessagesToBudget(messages, 10);
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe("continue");
  });

  it("replays an empty message's thought process so the next run can continue it", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "explain black holes" },
      { role: "assistant", content: "", meta: { reasoning: "cut off mid-thought about event horizons" } },
      { role: "user", content: "continue" },
    ];
    const out = truncateMessagesToBudget(messages, 5000);
    expect(out).toHaveLength(3);
    expect(String(out[1].content)).toContain("Thought process:");
    expect(String(out[1].content)).toContain("event horizons");
  });

  it("skips an over-budget empty shell instead of blocking older context", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "o".repeat(400) },
      { role: "assistant", content: "", meta: { reasoning: "r".repeat(8000) } },
      { role: "user", content: "continue" },
    ];
    // Fits the old + new user messages, but not the ~2k-char thought digest.
    const out = truncateMessagesToBudget(messages, 200);
    expect(out).toHaveLength(2);
    expect(out[0].content).toBe("o".repeat(400));
    expect(out[1].content).toBe("continue");
  });
});

describe("buildRunDigest", () => {
  it("returns empty string when there is nothing to replay", () => {
    expect(buildRunDigest({})).toBe("");
    expect(buildRunDigest({ reasoning: "   " })).toBe("");
    expect(
      buildRunDigest({
        activities: [
          { id: "t", kind: "tool", name: "web_search", status: "done" },
          { id: "s", kind: "subagent", name: "R", status: "error", output: "failed" },
        ],
      }),
    ).toBe("");
  });

  it("includes labeled reasoning streams", () => {
    const digest = buildRunDigest({
      reasoningStreams: [
        { id: "stage-plan", label: "Planner", text: "planning thoughts" },
        { id: "researcher-0", label: "Researcher 1", text: "search thoughts" },
      ],
    });
    expect(digest).toContain("Thought process:");
    expect(digest).toContain("[Planner]\nplanning thoughts");
    expect(digest).toContain("[Researcher 1]\nsearch thoughts");
  });

  it("falls back to bare reasoning when there are no streams", () => {
    const digest = buildRunDigest({ reasoning: "plain thought" });
    expect(digest).toContain("Thought process:\nplain thought");
  });

  it("includes sub-agent findings but skips errored and empty ones", () => {
    const digest = buildRunDigest({
      activities: [
        { id: "r0", kind: "subagent", name: "Research: A", status: "done", output: "findings A" },
        { id: "r1", kind: "subagent", name: "Research: B", status: "error", output: "boom" },
        { id: "r2", kind: "subagent", name: "Research: C", status: "done", output: "  " },
      ],
    });
    expect(digest).toContain("## Research: A\nfindings A");
    expect(digest).not.toContain("Research: B");
    expect(digest).not.toContain("Research: C");
  });

  it("clips long findings keeping head and tail", () => {
    const output = "H".repeat(5000) + "M".repeat(3000) + "T".repeat(1500);
    const digest = buildRunDigest({
      activities: [{ id: "r0", kind: "subagent", name: "R", status: "done", output }],
    });
    expect(digest).toContain("H".repeat(100)); // head kept
    expect(digest).toContain("T".repeat(100)); // tail kept (where a cut-off reply stopped)
    expect(digest).not.toContain("M".repeat(1000)); // middle dropped
    expect(digest).toContain("[…truncated…]");
  });

  it("includes artifact titles and content", () => {
    const digest = buildRunDigest({
      artifacts: [{ id: "a1", title: "Research Report", language: "markdown", content: "# Report\nbody", index: 0 }],
    });
    expect(digest).toContain("## Research Report (markdown)");
    expect(digest).toContain("# Report\nbody");
  });
});

describe("resolveHistoryBudget", () => {
  it("caps huge model windows at 250k", async () => {
    mockedContextWindow.mockResolvedValueOnce(1_000_000);
    await expect(resolveHistoryBudget(provider("https://api.example.com"), "big")).resolves.toBe(
      MAX_HISTORY_TOKENS,
    );
    expect(MAX_HISTORY_TOKENS).toBe(250000);
  });

  it("subtracts a realistic system+tools reserve from smaller windows", async () => {
    mockedContextWindow.mockResolvedValueOnce(128_000);
    await expect(resolveHistoryBudget(provider("https://api.example.com"), "mid")).resolves.toBe(
      128_000 - 16384,
    );
  });

  it("floors tiny local windows at the minimum instead of going negative", async () => {
    mockedContextWindow.mockResolvedValueOnce(null);
    await expect(resolveHistoryBudget(provider("http://localhost:11434"), "local")).resolves.toBe(
      1024,
    );
  });

  it("falls back to the default window when the catalog lookup fails", async () => {
    mockedContextWindow.mockRejectedValueOnce(new Error("offline"));
    await expect(resolveHistoryBudget(provider("https://api.example.com"), "x")).resolves.toBe(
      32768 - 16384,
    );
  });
});

describe("toHistoryMessage", () => {
  it("attaches run metadata for assistant messages that have it", () => {
    const out = toHistoryMessage(storedMsg({ reasoning: "thought", content: "answer" }));
    expect(out.role).toBe("assistant");
    expect(out.content).toBe("answer");
    expect(out.meta?.reasoning).toBe("thought");
  });

  it("leaves meta off user messages and metadata-free assistant messages", () => {
    expect(toHistoryMessage(storedMsg({ role: "user" })).meta).toBeUndefined();
    expect(toHistoryMessage(storedMsg({})).meta).toBeUndefined();
  });

  it("lets rebuilt content override the stored text", () => {
    const out = toHistoryMessage(storedMsg({ role: "user", content: "hi" }), "hi [file attached]");
    expect(out.content).toBe("hi [file attached]");
  });
});
