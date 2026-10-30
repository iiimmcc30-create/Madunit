import { describe, expect, it } from "vitest";
import { shouldClaimOwnerByUsername } from "./owner-claim";
describe("owner claim", () => {
  it("matches username only", () => {
    expect(shouldClaimOwnerByUsername("saad0558", "Saad0558")).toBe(true);
    expect(shouldClaimOwnerByUsername("@saad0558", "saad0558")).toBe(true);
    expect(shouldClaimOwnerByUsername("saad0558", "other")).toBe(false);
    expect(shouldClaimOwnerByUsername("", "x")).toBe(false);
    expect(shouldClaimOwnerByUsername("saad0558", undefined)).toBe(false);
  });
});
