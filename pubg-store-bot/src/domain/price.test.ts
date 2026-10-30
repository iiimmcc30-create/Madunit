import { describe, expect, it } from "vitest";
import { formatPrice, parsePrice } from "./price";

describe("parsePrice", () => {
  it("reads latin digits", () => {
    expect(parsePrice("150")).toBe(150);
    expect(parsePrice("150 ريال")).toBe(150);
    expect(parsePrice("السعر 1,200")).toBe(1200);
  });

  it("reads arabic-indic digits", () => {
    expect(parsePrice("١٥٠")).toBe(150);
    expect(parsePrice("السعر ١٥٠ ريال")).toBe(150);
  });

  it("rejects invalid values", () => {
    expect(parsePrice("مجاني")).toBeNull();
    expect(parsePrice("0")).toBeNull();
    expect(parsePrice("-10")).toBeNull();
  });
});

describe("formatPrice", () => {
  it("keeps integers clean", () => {
    expect(formatPrice(150)).toBe("150");
    expect(formatPrice(150.5)).toBe("150.50");
  });
});
