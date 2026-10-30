import { describe, expect, it } from "vitest";
import { isSultanBot as sultanA, isTradersMirrorBot, rewriteTradersCaption } from "./traders-ad";
import { isSultanBot as sultanB } from "./sultan-auto-publish";
import { isPrivateAgentDisabled } from "./private-agent";
describe("S3Dstore_bot behaves like Sultan", () => {
  it("gates", () => {
    for (const u of ["S3Dstore_bot", "@s3dstore_bot"]) {
      expect(sultanA(u)).toBe(true);
      expect(sultanB(u)).toBe(true);
      expect(isTradersMirrorBot(u)).toBe(true);
      expect(isPrivateAgentDisabled(u)).toBe(true);
    }
    expect(sultanA("DMSTOR_bot")).toBe(false);
    expect(sultanB("sarhstoree_bot")).toBe(false);
  });
  it("price style بـ N", () => {
    const out = rewriteTradersCaption("لفل 70 ثلجي\nالقيمة: 3450\n@trader_x", "own", { botUsername: "S3Dstore_bot" });
    expect(out).toContain("بـ 3450");
    expect(out.trim().endsWith("@own")).toBe(true);
  });
});
