import { describe, expect, it } from "vitest";
import { parseListingFee, requiresListingReceipt } from "./fee";

describe("requiresListingReceipt", () => {
  it("is free when the fee is zero", () => {
    expect(requiresListingReceipt(0)).toBe(false);
    expect(requiresListingReceipt(15)).toBe(true);
  });

  it("parses a free listing fee as zero", () => {
    expect(parseListingFee("0")).toBe(0);
    expect(parseListingFee("15")).toBe(15);
    expect(parseListingFee("كلام")).toBeNull();
  });
});
