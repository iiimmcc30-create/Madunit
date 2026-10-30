import { describe, expect, it } from "vitest";
import { formatRosterLines, dayLabel } from "./scrim-defaults";
import { nextRosterSlot } from "./scrim-flow";
import { parseMapList, mapEmoji, mapForRoom } from "./scrim-maps";
import { heuristicExtractScrimOpen } from "./scrim-parse";
import { parseMaxTeams } from "./scrim-types";
import { renderRoomIdCaption, renderRoomResultCaption, renderRosterCaption, renderOpenDetails } from "../services/scrim";
import { MAD_UNIT_PRESET } from "./scrim-presets";

describe("Mad Unit style", () => {
  it("allows team counts from 2 to 25", () => {
    expect(parseMaxTeams(19)).toBe(19);
    expect(parseMaxTeams("21")).toBe(21);
    expect(parseMaxTeams(26)).toBeNull();
    expect(parseMaxTeams(1)).toBeNull();
  });
  it("starts roster slots at the configured number", () => {
    expect(nextRosterSlot([], 5)).toBe(5);
    expect(nextRosterSlot([{ rosterSlot: 5, status: "CONFIRMED" }], 5)).toBe(6);
  });
  it("formats roster lines, optionally with empty slots", () => {
    expect(formatRosterLines([{ slot: 5, tag: "Royal" }], { lineFormat: "{n} ▸ {team}" })).toBe("5 ▸ Royal");
    expect(
      formatRosterLines([{ slot: 6, tag: "Kings" }], { lineFormat: "{n} ▸ {team}", startSlot: 5, totalSlots: 3, showEmpty: true }),
    ).toBe("5 ▸\n6 ▸ Kings\n7 ▸");
  });
  it("parses maps in order and per room", () => {
    const maps = parseMapList("Rondo, Miramar, Erangel, Rondo");
    expect(maps).toEqual(["Rondo", "Miramar", "Erangel", "Rondo"]);
    expect(parseMapList("روندو ميرامار ارانقل")).toEqual(["Rondo", "Miramar", "Erangel"]);
    expect(mapForRoom(maps, 3)).toBe("Erangel");
    expect(mapEmoji("Rondo")).toBe("🏔");
  });
  it("reads team count and maps from the open text", () => {
    const parsed = heuristicExtractScrimOpen("فتح سكرم خليجي الساعة 10 الليلة 19 تيم Rondo, Miramar, Erangel, Rondo");
    expect(parsed.maxTeams).toBe(19);
    expect(parsed.maps).toEqual(["Rondo", "Miramar", "Erangel", "Rondo"]);
    expect(parsed.roomCount).toBe(4);
  });
  it("renders the Mad Unit room, result, roster and details posts", () => {
    const tpl = { ...MAD_UNIT_PRESET };
    expect(renderRoomIdCaption(tpl, { roomId: "1030683", password: "55" }, { index: 1, maps: tpl.defaultMaps })).toBe(
      "MadUnitScrims\nRondo 🏔\nId • 1030683\nPass • 55\nStart • 5m\nsame tag 3 or 0 points",
    );
    const result = renderRoomResultCaption(
      tpl,
      2,
      { rows: [{ place: 1, tag: "winnerHotline", kills: 17 }], topKiller: { name: "winnerAzzh", tag: "winnerHotline", kills: 9 } },
      tpl.defaultMaps,
    );
    expect(result).toContain("wwcd #winnerHotline\nwith #17kills");
    expect(result).toContain("#winnerAzzh");
    const roster = renderRosterCaption(tpl, {
      kind: "GULF",
      scheduledAtLabel: "12:00",
      rules: "",
      maxTeams: 20,
      startsAt: new Date("2026-02-12T18:00:00Z"),
      teams: [{ status: "CONFIRMED", rosterSlot: 5, tag: "Mad Unit Royal" }] as never,
    });
    expect(roster).toContain("Mad Unit SCRIMS\n\n5 ▸ Mad Unit Royal\n\nDay 12 Feb\nFirst id 12:00");
    expect(renderOpenDetails(tpl, { kind: "GULF", scheduledAtLabel: "10:00", maxTeams: 18, roomCount: 4, rules: "" })).toContain(
      "تحديد نزلات 18 تيم",
    );
    expect(dayLabel(new Date("2026-02-12T22:30:00Z"))).toBe("13 Feb");
  });
});
