import { describe, expect, it } from "vitest";
import { estimateCostUsd } from "./cost";

describe("estimateCostUsd", () => {
  it("prices gpt-4o-mini usage per million tokens", () => {
    expect(estimateCostUsd(1_000_000, 0, 0.15, 0.6)).toBeCloseTo(0.15);
    expect(estimateCostUsd(0, 1_000_000, 0.15, 0.6)).toBeCloseTo(0.6);
  });
});
