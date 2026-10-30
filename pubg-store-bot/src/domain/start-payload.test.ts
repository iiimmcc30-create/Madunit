import { describe, expect, it } from "vitest";
import {
  askStartPayload,
  botDeepLink,
  parseStartPayload,
  scrimStartPayload,
  storeStartPayload,
} from "./start-payload";

describe("start payloads", () => {
  it("builds and parses a private store invite", () => {
    const payload = storeStartPayload("clxyzstoreid0000000000001");
    expect(payload).toBe("store_clxyzstoreid0000000000001");
    expect(parseStartPayload(payload)).toEqual({
      kind: "store",
      storeId: "clxyzstoreid0000000000001",
    });
  });

  it("builds and parses an inquiry deep link", () => {
    expect(askStartPayload("A001")).toBe("ask_A001");
    expect(parseStartPayload("ask_A001")).toEqual({ kind: "ask", shortCode: "A001" });
    expect(parseStartPayload("ask_a7")).toEqual({ kind: "ask", shortCode: "A007" });
  });

  it("builds and parses a scrim deep link", () => {
    const payload = scrimStartPayload("clxyzscrimid0000000000001");
    expect(payload).toBe("scrim_clxyzscrimid0000000000001");
    expect(parseStartPayload(payload)).toEqual({
      kind: "scrim",
      scrimId: "clxyzscrimid0000000000001",
    });
  });

  it("ignores empty or unknown payloads", () => {
    expect(parseStartPayload(undefined)).toEqual({ kind: "none" });
    expect(parseStartPayload("")).toEqual({ kind: "none" });
    expect(parseStartPayload("hello")).toEqual({ kind: "none" });
  });

  it("builds a t.me start url", () => {
    expect(botDeepLink("@MyBot", "ask_A001")).toBe("https://t.me/MyBot?start=ask_A001");
  });
});
