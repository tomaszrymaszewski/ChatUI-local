import { describe, expect, it } from "vitest";
import { normalizePath, isPathWithin } from "@/lib/agent/sandbox";

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
