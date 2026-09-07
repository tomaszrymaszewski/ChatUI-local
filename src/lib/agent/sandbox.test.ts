import { describe, expect, it } from "vitest";
import {
  isSessionReadable,
  isPathWithin,
  normalizePath,
  type AgentSandbox,
} from "@/lib/agent/sandbox";

const HOME = "/Users/tester";

describe("normalizePath", () => {
  it("expands ~ and ~/", () => {
    expect(normalizePath("~", HOME)).toBe(HOME);
    expect(normalizePath("~/Documents/chatUI", HOME)).toBe(
      `${HOME}/Documents/chatUI`,
    );
  });

  it("leaves ~ alone without a home", () => {
    expect(normalizePath("~/Documents")).toBe("~/Documents");
  });

  it("collapses duplicate separators and dots", () => {
    expect(normalizePath("/Users/x//projects/./src")).toBe("/Users/x/projects/src");
  });

  it("resolves .. lexically", () => {
    expect(normalizePath("/Users/x/projects/../projects/src")).toBe(
      "/Users/x/projects/src",
    );
  });

  it("drops trailing slashes", () => {
    expect(normalizePath("/Users/x/projects/")).toBe("/Users/x/projects");
  });

  it("trims whitespace", () => {
    expect(normalizePath("  /Users/x  ")).toBe("/Users/x");
  });
});

describe("isPathWithin", () => {
  it("accepts the directory itself and children", () => {
    expect(isPathWithin("/Users/x/projects", "/Users/x/projects", HOME)).toBe(true);
    expect(isPathWithin("/Users/x/projects/app/src/main.rs", "/Users/x/projects", HOME)).toBe(true);
  });

  it("rejects siblings and prefix-lookalikes", () => {
    // "projects-2" shares the prefix "projects" but is a sibling, not a child.
    expect(isPathWithin("/Users/x/projects-2/file.txt", "/Users/x/projects", HOME)).toBe(false);
    expect(isPathWithin("/Users/x/other/file.txt", "/Users/x/projects", HOME)).toBe(false);
  });

  it("expands ~ on either side", () => {
    expect(isPathWithin("~/Documents/report.pdf", "/Users/tester/Documents", HOME)).toBe(true);
    expect(isPathWithin("/Users/tester/Documents/a.txt", "~/Documents", HOME)).toBe(true);
  });

  it("is case-insensitive (macOS filesystems)", () => {
    expect(isPathWithin("/users/X/Projects/app", "/Users/x/projects", HOME)).toBe(true);
  });

  it("resolves .. escapes out of the directory", () => {
    expect(
      isPathWithin("/Users/x/projects/../secrets.env", "/Users/x/projects", HOME),
    ).toBe(false);
  });

  it("rejects empty directories", () => {
    expect(isPathWithin("/Users/x", "", HOME)).toBe(false);
  });
});

describe("isSessionReadable (search_chats scope)", () => {
  const baseSandbox: AgentSandbox = { agentId: "agent-a" };
  const own = { id: "s1", agentId: "agent-a" };
  const otherAgent = { id: "s2", agentId: "agent-b" };
  const chat = { id: "s3" };
  const task = { id: "s4", agentId: undefined };
  const temp = { id: "s5", isTemporary: true };

  it("reads nothing when every scope is off", () => {
    for (const session of [own, otherAgent, chat, temp]) {
      expect(isSessionReadable(session, baseSandbox)).toBe(false);
    }
  });

  it("readChats grants only the agent's own sessions", () => {
    const sandbox: AgentSandbox = { ...baseSandbox, readChats: true };
    expect(isSessionReadable(own, sandbox)).toBe(true);
    expect(isSessionReadable(otherAgent, sandbox)).toBe(false);
    expect(isSessionReadable(chat, sandbox)).toBe(false);
  });

  it("externalChats=all grants everything except temporary chats", () => {
    const sandbox: AgentSandbox = { ...baseSandbox, externalChats: "all" };
    expect(isSessionReadable(otherAgent, sandbox)).toBe(true);
    expect(isSessionReadable(chat, sandbox)).toBe(true);
    expect(isSessionReadable(task, sandbox)).toBe(true);
    expect(isSessionReadable(temp, sandbox)).toBe(false);
    // Own sessions still need readChats, not the external scope.
    expect(isSessionReadable(own, sandbox)).toBe(false);
  });

  it("externalChats=selected grants only the picked session ids", () => {
    const sandbox: AgentSandbox = {
      ...baseSandbox,
      externalChats: "selected",
      allowedExternalSessions: ["s3"],
    };
    expect(isSessionReadable(chat, sandbox)).toBe(true);
    expect(isSessionReadable(otherAgent, sandbox)).toBe(false);
    expect(isSessionReadable(task, sandbox)).toBe(false);
  });

  it("combines own + external access additively", () => {
    const sandbox: AgentSandbox = {
      ...baseSandbox,
      readChats: true,
      externalChats: "all",
    };
    expect(isSessionReadable(own, sandbox)).toBe(true);
    expect(isSessionReadable(chat, sandbox)).toBe(true);
    expect(isSessionReadable(temp, sandbox)).toBe(false);
  });
});
