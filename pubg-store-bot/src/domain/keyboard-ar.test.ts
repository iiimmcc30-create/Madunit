import { describe, expect, it } from "vitest";
import { decodeEnglishKeyboardArabic, normalizeUserText } from "./keyboard-ar";

describe("كيبورد إنجليزي بدل العربي", () => {
  it("يفك «s,d» إلى سوي", () => {
    expect(decodeEnglishKeyboardArabic("s,d")).toBe("سوي");
    expect(normalizeUserText("s,d")).toBe("سوي");
  });

  it("ما يلمس الإنجليزي الواضح", () => {
    expect(normalizeUserText("how much for this")).toBe("how much for this");
  });
});
