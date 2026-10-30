import { describe, expect, it } from "vitest";
import { parseBanTarget, startOfUtcDay } from "./moderation";

describe("parseBanTarget", () => {
  it("reads a listing code or a telegram id with an optional reason", () => {
    expect(parseBanTarget("/ban A12")).toEqual({ listingCode: "A012", reason: undefined });
    expect(parseBanTarget("/ban A001 غش")).toEqual({ listingCode: "A001", reason: "غش" });
    expect(parseBanTarget("/ban 123456789 تكرار")).toEqual({
      telegramId: "123456789",
      reason: "تكرار",
    });
    expect(parseBanTarget("/unban")).toBeNull();
  });
});

describe("startOfUtcDay", () => {
  it("resets to midnight utc", () => {
    const day = startOfUtcDay(new Date("2026-10-12T15:30:00.000Z"));
    expect(day.toISOString()).toBe("2026-10-12T00:00:00.000Z");
  });
});
