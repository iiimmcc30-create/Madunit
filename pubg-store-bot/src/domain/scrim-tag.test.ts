import { describe, expect, it } from "vitest";
import { isCommitPhrase, normalizeScrimTag } from "./scrim-tag";

describe("normalizeScrimTag", () => {
  it("uppercases and strips extra symbols", () => {
    expect(normalizeScrimTag("  @t.eam-01!! ")).toBe("TEAM01");
    expect(normalizeScrimTag("nx_wolf")).toBe("NX_WOLF");
  });

  it("rejects too short or too long tags", () => {
    expect(normalizeScrimTag("A")).toBeNull();
    expect(normalizeScrimTag("ABCDEFGHIJKLMNOPQ")).toBeNull();
  });
});

describe("isCommitPhrase", () => {
  it("accepts ملتزمين with extra punctuation", () => {
    expect(isCommitPhrase("ملتزمين")).toBe(true);
    expect(isCommitPhrase("ملتزمين!")).toBe(true);
    expect(isCommitPhrase("مو ملتزم")).toBe(false);
  });
});
