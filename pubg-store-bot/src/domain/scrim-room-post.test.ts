import { describe, expect, it } from "vitest";
import { resolveRoomIdMode, roomChannelPostAt, stripPasswordLines } from "./scrim-room-post";
import { renderRoomIdPublicCaption } from "../services/scrim";
import { MAD_UNIT_PRESET } from "./scrim-presets";

describe("room Id channel post", () => {
  it("resolves the mode with backward compatibility", () => {
    expect(resolveRoomIdMode({ roomIdChannelMode: "", postRoomPassToChannel: false })).toBe("notice");
    expect(resolveRoomIdMode({ roomIdChannelMode: "", postRoomPassToChannel: true })).toBe("full");
    expect(resolveRoomIdMode({ roomIdChannelMode: "id_only", postRoomPassToChannel: true })).toBe("id_only");
  });
  it("drops password lines for the public post", () => {
    expect(stripPasswordLines("Id • {id}\nPass • {pass}\nStart • 5m")).toBe("Id • {id}\nStart • 5m");
    expect(
      renderRoomIdPublicCaption(MAD_UNIT_PRESET, { roomId: "1030683", password: "55" }, { index: 1, maps: MAD_UNIT_PRESET.defaultMaps }),
    ).toBe("MadUnitScrims\nRondo 🏔\nId • 1030683\nStart • 5m\nsame tag 3 or 0 points");
  });
  it("schedules room 1 seven minutes before start, others now", () => {
    const start = new Date("2026-10-16T19:00:00Z");
    const early = new Date("2026-10-16T18:30:00Z");
    expect(roomChannelPostAt({ roomIndex: 1, startsAt: start, leadMinutes: 7 }, early)?.toISOString()).toBe("2026-10-16T18:53:00.000Z");
    expect(roomChannelPostAt({ roomIndex: 1, startsAt: start, leadMinutes: 7 }, new Date("2026-10-16T18:55:00Z"))).toBeNull();
    expect(roomChannelPostAt({ roomIndex: 2, startsAt: start, leadMinutes: 7 }, early)).toBeNull();
    expect(roomChannelPostAt({ roomIndex: 1, startsAt: null, leadMinutes: 7 }, early)).toBeNull();
  });
});
