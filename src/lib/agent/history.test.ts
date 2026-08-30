import { describe, expect, it } from "vitest";
import {
  estimateMessageTokens,
  truncateMessagesToBudget,
} from "./history";

const msg = (chars: number) => ({ role: "user" as const, content: "x".repeat(chars) });

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
});
