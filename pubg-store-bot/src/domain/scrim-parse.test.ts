import { describe, expect, it } from "vitest";
import {
  heuristicExtractRoomCredentials,
  heuristicExtractScrimOpen,
  looksLikeJoinScrim,
  looksLikeOpenScrim,
  parseScrimRoomResult,
} from "./scrim-parse";

describe("scrim open extract", () => {
  it("reads gulf scrim from free Arabic", () => {
    const parsed = heuristicExtractScrimOpen("افتح سكرم خليجي الساعة 10 الليلة 16 تيم 3 رومات سري 4455");
    expect(parsed.kind).toBe("GULF");
    expect(parsed.maxTeams).toBe(16);
    expect(parsed.roomCount).toBe(3);
    expect(parsed.roomSecret).toBe("4455");
    expect(parsed.timeLabel).toContain("10");
  });

  it("detects open and join phrases", () => {
    expect(looksLikeOpenScrim("افتح سكرم أوروبي الساعة 9")).toBe(true);
    expect(looksLikeJoinScrim("ابي اشارك")).toBe(true);
    expect(looksLikeJoinScrim("في مكان؟")).toBe(true);
    expect(looksLikeJoinScrim("كم سعر الحساب")).toBe(false);
  });
});

describe("room credentials", () => {
  it("extracts id and password from free text", () => {
    expect(heuristicExtractRoomCredentials("آيدي الروم: 123456 الباسورد: ab12")).toEqual({
      roomId: "123456",
      password: "ab12",
    });
  });
});

describe("parseScrimRoomResult", () => {
  it("keeps readable top 5 and never invents missing kills", () => {
    const parsed = parseScrimRoomResult({
      rows: [
        { place: 1, tag: "AAA", kills: 12 },
        { place: 2, tag: "BBB", kills: 8 },
        { place: 3, tag: "CCC" },
        { place: 9, tag: "DDD", kills: 1 },
      ],
      topKiller: { name: "wolf", tag: "AAA", kills: 12 },
    });
    expect(parsed?.rows.map((row) => row.tag)).toEqual(["AAA", "BBB"]);
    expect(parsed?.topKiller).toEqual({ name: "wolf", tag: "AAA", kills: 12 });
  });

  it("returns null when nothing readable", () => {
    expect(parseScrimRoomResult({ rows: [{ place: 1, tag: "X" }] })).toBeNull();
  });
});
