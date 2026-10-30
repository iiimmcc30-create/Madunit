import { describe, expect, it } from "vitest";
import { extractListedPrice } from "./extract";

describe("extractListedPrice", () => {
  it("takes قيمة 1000 not 2 كونكر", () => {
    const text =
      "اعلان السقوط B كامل ، 2 كونكر ، المجموعات65 ، لفل 83 ، 2 قصات الشعر القيمه : 1000 @iir8rr";
    expect(extractListedPrice(text)).toBe(1000);
  });
  it("reads short bare price", () => {
    expect(extractListedPrice("1000")).toBe(1000);
  });
  it("does not invent price from 2 كونكر alone in long ad", () => {
    const text = "اعلان السقوط B كامل ، 2 كونكر ، المجموعات65 ، لفل 83 ، 2 قصات الشعر";
    expect(extractListedPrice(text)).toBeNull();
  });
});
