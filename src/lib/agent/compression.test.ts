import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ToolMessage } from "langchain";

let compressionEnabled = false;

vi.mock("@/hooks/use-user-settings", () => ({
  loadUserSettings: () => ({ contextCompression: compressionEnabled }),
}));

vi.mock("@/lib/headroom-client", () => ({
  compressMessages: vi.fn(),
  headroomAvailable: vi.fn(() => true),
}));

import { compressMessages, headroomAvailable } from "@/lib/headroom-client";
import {
  compressHistoryMessages,
  toolCompressionMiddleware,
} from "./compression";
import type { AgentMessage } from "./runtime";

const mockedCompress = vi.mocked(compressMessages);
const mockedAvailable = vi.mocked(headroomAvailable);

beforeEach(() => {
  compressionEnabled = false;
  vi.clearAllMocks();
  mockedAvailable.mockReturnValue(true);
  mockedCompress.mockResolvedValue({
    messages: [],
    tokensBefore: 0,
    tokensAfter: 0,
    tokensSaved: 0,
    compressionRatio: 0,
    compressed: false,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function toolMessage(content: string) {
  return new ToolMessage({ content, tool_call_id: "tc1", name: "web_fetch" });
}

describe("toolCompressionMiddleware", () => {
  it("passes short results through untouched", async () => {
    compressionEnabled = true;
    const mw = toolCompressionMiddleware("gpt-4o");
    const msg = toolMessage("short");
    const result = await mw.wrapToolCall!(
      ({ toolCall: {} } as never),
      async () => msg,
    );
    expect(result).toBe(msg);
    expect(mockedCompress).not.toHaveBeenCalled();
  });

  it("compresses large tool results in place when enabled", async () => {
    compressionEnabled = true;
    mockedCompress.mockResolvedValue({
      messages: [{ role: "tool", content: "kept essentials", tool_call_id: "tc1" }],
      tokensBefore: 1000,
      tokensAfter: 200,
      tokensSaved: 800,
      compressionRatio: 0.8,
      compressed: true,
    });
    const mw = toolCompressionMiddleware("gpt-4o");
    const original = toolMessage("long".repeat(1200));
    const result = await mw.wrapToolCall!(
      ({ toolCall: { id: "tc1" } } as never),
      async () => original,
    );
    expect(result).toBe(original); // mutated in place, identity preserved
    expect(original.content).toBe("kept essentials");
    expect(mockedCompress).toHaveBeenCalledWith(
      [{ role: "tool", content: "long".repeat(1200), tool_call_id: "tc1" }],
      "gpt-4o",
    );
  });

  it("keeps the original when compression is disabled", async () => {
    compressionEnabled = false;
    const mw = toolCompressionMiddleware("gpt-4o");
    const original = toolMessage("long".repeat(1200));
    const result = await mw.wrapToolCall!(({ toolCall: {} } as never), async () => original);
    expect(result).toBe(original);
    expect(original.content).toBe("long".repeat(1200));
    expect(mockedCompress).not.toHaveBeenCalled();
  });

  it("does not replace with a longer string (proxy made nothing smaller)", async () => {
    compressionEnabled = true;
    const cx = "long".repeat(1200);
    mockedCompress.mockResolvedValue({
      messages: [{ role: "tool", content: cx + "!" }],
      tokensBefore: 1,
      tokensAfter: 2,
      tokensSaved: 0,
      compressionRatio: 0,
      compressed: true,
    });
    const mw = toolCompressionMiddleware("gpt-4o");
    const original = toolMessage(cx);
    const result = await mw.wrapToolCall!(({ toolCall: {} } as never), async () => original);
    expect(result).toBe(original);
    expect(original.content).toBe(cx);
  });
});

describe("compressHistoryMessages", () => {
  const msgs: AgentMessage[] = [
    { role: "user", content: "older user message content that is long enough to bother compressing".repeat(3) },
    { role: "assistant", content: "an assistant reply with enough length to be worth compressing for overhead".repeat(3) },
    { role: "user", content: "latest prompt — this must survive byte-for-byte unchanged in full".repeat(3) },
  ];

  it("returns messages unchanged when disabled", async () => {
    compressionEnabled = false;
    const result = await compressHistoryMessages(msgs, "gpt-4o");
    expect(result).toBe(msgs);
    expect(mockedCompress).not.toHaveBeenCalled();
  });

  it("compresses older turns but keeps the latest verbatim", async () => {
    compressionEnabled = true;
    mockedCompress.mockResolvedValue({
      messages: [
        { role: "user", content: "compressed first" },
        { role: "assistant", content: "compressed second" },
      ],
      tokensBefore: 1000,
      tokensAfter: 100,
      tokensSaved: 900,
      compressionRatio: 0.9,
      compressed: true,
    });

    const result = await compressHistoryMessages(msgs, "gpt-4o");
    expect(result).toHaveLength(3);
    expect(String(result[0].content)).toBe("compressed first");
    expect(String(result[1].content)).toBe("compressed second");
    // Latest user message must survive byte-for-byte.
    expect(String(result[2].content)).toBe(String(msgs[2].content));
    expect(mockedCompress).toHaveBeenCalledWith(
      [msgs[0].content, msgs[1].content].map((c, i) => ({
        role: i === 0 ? "user" : "assistant",
        content: c,
      })),
      "gpt-4o",
    );
  });

  it("does not shrink when the proxy makes nothing smaller", async () => {
    compressionEnabled = true;
    mockedCompress.mockResolvedValue({
      messages: [
        { role: "user", content: String(msgs[0].content) + "!" },
        { role: "assistant", content: String(msgs[1].content) },
      ],
      tokensBefore: 1,
      tokensAfter: 1,
      tokensSaved: 0,
      compressionRatio: 0,
      compressed: true,
    });
    const result = await compressHistoryMessages(msgs, "gpt-4o");
    expect(result).toBe(msgs);
  });

  it("skips when the breaker is open", async () => {
    compressionEnabled = true;
    mockedAvailable.mockReturnValue(false);
    const result = await compressHistoryMessages(msgs, "gpt-4o");
    expect(result).toBe(msgs);
    expect(mockedCompress).not.toHaveBeenCalled();
  });
});
