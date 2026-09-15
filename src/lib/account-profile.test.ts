import { describe, expect, it } from "vitest";
import type { User } from "@supabase/supabase-js";
import {
  avatarColorStyle,
  getAccountProfile,
  profileInitials,
  sidebarAccountLabel,
} from "@/lib/account-profile";

function user(meta: Record<string, unknown>, email = "ada@example.com"): User {
  return { email, user_metadata: meta } as User;
}

describe("getAccountProfile", () => {
  it("prefers Google-style metadata (full_name + avatar_url)", () => {
    const profile = getAccountProfile(
      user({ full_name: "Ada Lovelace", avatar_url: "https://img/a.png" }),
    );
    expect(profile).toEqual({
      email: "ada@example.com",
      name: "Ada Lovelace",
      avatarUrl: "https://img/a.png",
    });
  });

  it("falls back to GitHub-style metadata (name + picture)", () => {
    const profile = getAccountProfile(
      user({ name: "Ada", picture: "https://img/b.png" }),
    );
    expect(profile?.name).toBe("Ada");
    expect(profile?.avatarUrl).toBe("https://img/b.png");
  });

  it("falls back to the email when no metadata is set", () => {
    const profile = getAccountProfile(user({}));
    expect(profile?.name).toBe("ada@example.com");
    expect(profile?.avatarUrl).toBeNull();
  });

  it("returns null without a user", () => {
    expect(getAccountProfile(null)).toBeNull();
  });
});

describe("avatarColorStyle", () => {
  it("is stable for the same key", () => {
    expect(avatarColorStyle("ada@example.com")).toEqual(
      avatarColorStyle("ada@example.com"),
    );
  });

  it("returns a solid background with white text", () => {
    const style = avatarColorStyle("ada@example.com");
    expect(style.backgroundColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(style.color).toBe("#ffffff");
  });

  it("varies between different accounts", () => {
    const emails = Array.from({ length: 20 }, (_, i) => `user${i}@example.com`);
    const colors = new Set(emails.map((e) => avatarColorStyle(e).backgroundColor));
    expect(colors.size).toBeGreaterThan(1);
  });
});

describe("sidebarAccountLabel", () => {
  it("shows a two-word name instead of the email", () => {
    expect(
      sidebarAccountLabel({
        email: "ada@example.com",
        name: "Ada Lovelace",
        avatarUrl: null,
      }),
    ).toBe("Ada Lovelace");
  });

  it("keeps the email for a single-word name", () => {
    expect(
      sidebarAccountLabel({ email: "ada@example.com", name: "Ada", avatarUrl: null }),
    ).toBe("ada@example.com");
  });

  it("keeps the email when no display name is set", () => {
    expect(
      sidebarAccountLabel({
        email: "ada@example.com",
        name: "ada@example.com",
        avatarUrl: null,
      }),
    ).toBe("ada@example.com");
  });
});

describe("profileInitials", () => {
  it("uses the first letters of the first two words", () => {
    expect(profileInitials("Ada Lovelace", "ada@example.com")).toBe("AL");
  });

  it("derives initials from the email when the name is blank", () => {
    expect(profileInitials("", "ada@example.com")).toBe("AD");
  });
});
