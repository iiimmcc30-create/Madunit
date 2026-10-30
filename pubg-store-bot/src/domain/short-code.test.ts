import { describe, expect, it } from "vitest";
import {
  extractAdIdentity,
  formatShortCode,
  normalizeShortCode,
  parseOwnerCommandPayload,
  parseShortCodeParts,
  parseSyncChannelPayload,
} from "./short-code";

describe("short codes", () => {
  it("pads to three digits with default A", () => {
    expect(formatShortCode(1)).toBe("A001");
    expect(formatShortCode(123)).toBe("A123");
    expect(formatShortCode(1000)).toBe("A1000");
  });

  it("mints with custom prefix", () => {
    expect(formatShortCode(1442, "F")).toBe("F1442");
    expect(formatShortCode(1, "f")).toBe("F001");
  });

  it("normalizes letter+digit user input", () => {
    expect(normalizeShortCode("a1")).toBe("A001");
    expect(normalizeShortCode("A123")).toBe("A123");
    expect(normalizeShortCode("رقم A007")).toBe("A007");
    expect(normalizeShortCode("f1442")).toBe("F1442");
    expect(normalizeShortCode("F1442 موجود؟")).toBe("F1442");
    expect(normalizeShortCode("hello")).toBeNull();
  });

  it("extracts hash identities", () => {
    expect(extractAdIdentity("#6930 لفل 84")).toBe("#6930");
    expect(extractAdIdentity("F1442")).toBe("F1442");
    expect(extractAdIdentity("لا شيء")).toBeNull();
  });

  it("parses parts", () => {
    expect(parseShortCodeParts("F1442")).toEqual({ prefix: "F", seq: 1442 });
    expect(parseShortCodeParts("a7")).toEqual({ prefix: "A", seq: 7 });
    expect(parseShortCodeParts("#6930")).toBeNull();
  });

  it("parses owner commands", () => {
    expect(parseOwnerCommandPayload("/sold A123")).toBe("A123");
    expect(parseOwnerCommandPayload("/sold@MyBot a7")).toBe("A007");
    expect(parseOwnerCommandPayload("/delete F1442")).toBe("F1442");
    expect(parseOwnerCommandPayload("/sold")).toBeNull();
  });

  it("parses sync_channel payload", () => {
    expect(parseSyncChannelPayload("/sync_channel")).toBeNull();
    expect(parseSyncChannelPayload("/sync_channel F1442")).toBe("F1442");
    expect(parseSyncChannelPayload("/sync_channel@bot #6930")).toBe("#6930");
  });
});
