import { describe, expect, it } from "vitest";
import {
  NEW_AGENT_SESSION_SUGGESTIONS,
  NEW_AGENT_SUGGESTIONS,
  followUpSuggestion,
  lastKeyword,
  sessionSuggestionsFor,
} from "@/lib/agent-suggestions";

describe("agent suggestions", () => {
  it("ships non-empty curated lists with no placeholders", () => {
    for (const list of [NEW_AGENT_SESSION_SUGGESTIONS, NEW_AGENT_SUGGESTIONS]) {
      expect(list.length).toBeGreaterThan(0);
      for (const s of list) {
        expect(s.trim().length).toBeGreaterThan(0);
        expect(s).not.toMatch(/lorem|todo|example\.com/i);
      }
    }
  });

  it("returns null with no assistant reply yet", () => {
    expect(followUpSuggestion([])).toBeNull();
    expect(
      followUpSuggestion([{ role: "user", content: "hello there" }]),
    ).toBeNull();
  });

  it("stays quiet when the agent just asked a question", () => {
    expect(
      followUpSuggestion([
        { role: "user", content: "plan my trip" },
        { role: "assistant", content: "Where are you going?" },
      ]),
    ).toBeNull();
  });

  it("suggests a code walkthrough for code answers", () => {
    expect(
      followUpSuggestion([
        { role: "assistant", content: "Here it is:\n```py\nprint(1)\n```" },
      ]),
    ).toBe("Walk me through this code step by step");
  });

  it("suggests a summary for long answers", () => {
    expect(
      followUpSuggestion([{ role: "assistant", content: `x`.repeat(1300) }]),
    ).toBe("Summarize the key points");
  });

  it("personalizes with the user's own topic word", () => {
    expect(
      followUpSuggestion([
        { role: "user", content: "Help me plan my trip to Japan" },
        { role: "assistant", content: "Japan is lovely in autumn. Here are some ideas." },
      ]),
    ).toBe("What else should I know about Japan?");
  });

  it("falls back to a stable per-conversation rotation without keywords", () => {
    const messages = [
      { role: "user", content: "ok thanks!" },
      { role: "assistant", content: "You are welcome." },
    ];
    const first = followUpSuggestion(messages);
    const again = followUpSuggestion(messages);
    expect(first).toBeTruthy();
    expect(first).toBe(again);
    // A different conversation rotates to (usually) a different suggestion.
    const other = followUpSuggestion([
      { role: "user", content: "yes please" },
      { role: "assistant", content: "Here is a completely different answer." },
    ]);
    expect(other).toBeTruthy();
  });

  it("extracts the last topical word and skips filler", () => {
    expect(lastKeyword("Help me plan my trip to Japan")).toBe("Japan");
    expect(lastKeyword("thanks!")).toBeUndefined();
    expect(lastKeyword("ok")).toBeUndefined();
    expect(lastKeyword("Can you explain recursion?")).toBe("recursion");
  });
});

describe("sessionSuggestionsFor", () => {
  const agent = { id: "a1", name: "Wrangler", purpose: "Chases invoices" };

  it("returns nothing without a picked agent", () => {
    expect(sessionSuggestionsFor(null, [])).toEqual([]);
  });

  it("leads with that agent's recent sessions and names the agent", () => {
    const out = sessionSuggestionsFor(agent, [
      { agentId: "other", title: "Someone else's chat" },
      { agentId: "a1", title: "Q3 invoices" },
      { agentId: "a1", title: "Overdue follow-ups" },
    ]);
    expect(out[0]).toBe('Follow up on "Q3 invoices"');
    expect(out[1]).toBe('Follow up on "Overdue follow-ups"');
    expect(out).toContain("Ask Wrangler what it can help with");
    expect(out).not.toContain("Someone else's chat");
  });

  it("caps the list and never duplicates", () => {
    const out = sessionSuggestionsFor(agent, []);
    expect(out.length).toBeLessThanOrEqual(6);
    expect(new Set(out).size).toBe(out.length);
  });
});
