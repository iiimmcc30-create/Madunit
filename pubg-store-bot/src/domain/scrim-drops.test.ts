import { describe, expect, it } from "vitest";
import { applyDropClaim, emptyDropsState, formatTeamDrops, parseDropClaim, spotName } from "./scrim-drops";
import { dueScheduledOpen, dueScrimActions, parseScheduleCommand } from "./scrim-schedule";
import { formatRiyadhTime, nextDailyOccurrence, parseScrimStartTime } from "./scrim-time";

describe("parseDropClaim", () => {
  it("parses both maps with ':' or ';', any case, Arabic digits", () => {
    expect(parseDropClaim("ALPHA | E:5 M:8")).toEqual({ ok: true, claim: { team: "ALPHA", E: 5, M: 8 } });
    expect(parseDropClaim("alpha|e;5 m;8")).toEqual({ ok: true, claim: { team: "alpha", E: 5, M: 8 } });
    expect(parseDropClaim("ALPHA | E : ١٢")).toEqual({ ok: true, claim: { team: "ALPHA", E: 12 } });
    expect(parseDropClaim("ALPHA M:3")).toEqual({ ok: true, claim: { team: "ALPHA", M: 3 } });
  });
  it("rejects out-of-range numbers", () => {
    expect(parseDropClaim("ALPHA | E:21")).toEqual({ ok: false, reason: "range" });
    expect(parseDropClaim("ALPHA | E:0")).toEqual({ ok: false, reason: "range" });
  });
  it("ignores chatter", () => {
    expect(parseDropClaim("وين ننزل يا شباب")).toBeNull();
    expect(parseDropClaim("E:5")).toBeNull();
    expect(parseDropClaim("hello MEM:5x")).toBeNull();
  });
});

describe("applyDropClaim", () => {
  it("first come wins and replies taken", () => {
    const first = applyDropClaim(emptyDropsState(), "AAA", { E: 5, M: 8 });
    expect(first.kind).toBe("ok");
    if (first.kind !== "ok") return;
    expect(applyDropClaim(first.state, "BBB", { E: 5 })).toEqual({ kind: "taken", map: "E", n: 5, owner: "AAA" });
    expect(applyDropClaim(first.state, "BBB", { M: 8 })).toMatchObject({ kind: "taken", map: "M" });
  });
  it("same claim again is flagged, a different one replaces and frees the old spot", () => {
    const first = applyDropClaim(emptyDropsState(), "AAA", { E: 5 });
    if (first.kind !== "ok") throw new Error();
    expect(applyDropClaim(first.state, "AAA", { E: 5 })).toEqual({ kind: "same" });
    const moved = applyDropClaim(first.state, "AAA", { E: 6 });
    if (moved.kind !== "ok") throw new Error();
    expect(moved.replaced).toBe(true);
    expect(moved.state.spots).toEqual({ "E:6": "AAA" });
    expect(applyDropClaim(moved.state, "BBB", { E: 5 }).kind).toBe("ok");
  });
  it("names spots", () => {
    expect(spotName("E", 1)).toBe("Pochinki");
    expect(spotName("E", 20)).toBe("Severny");
    expect(spotName("M", 8)).toBe("Monte Nuevo");
    expect(spotName("M", 20)).toBe("Ladrillera");
    expect(formatTeamDrops({ E: 5, M: 8 })).toBe("إرانغل 5 (Farm) · ميرامار 8 (Monte Nuevo)");
  });
});

describe("scrim time (Asia/Riyadh)", () => {
  const now = new Date("2026-10-16T12:00:00Z"); // 15:00 Riyadh
  it("finds the next daily occurrence", () => {
    expect(nextDailyOccurrence(22, 0, now).toISOString()).toBe("2026-10-16T19:00:00.000Z");
    expect(nextDailyOccurrence(10, 0, now).toISOString()).toBe("2026-10-17T07:00:00.000Z");
  });
  it("parses labels as evening by default", () => {
    expect(parseScrimStartTime("10 الليلة", now)?.toISOString()).toBe("2026-10-16T19:00:00.000Z");
    expect(parseScrimStartTime("22:30", now)?.toISOString()).toBe("2026-10-16T19:30:00.000Z");
    expect(parseScrimStartTime("الساعة ٩:٣٠ م", now)?.toISOString()).toBe("2026-10-16T18:30:00.000Z");
    expect(parseScrimStartTime("بعد العشاء", now)).toBeNull();
    expect(formatRiyadhTime(new Date("2026-10-16T19:00:00Z"))).toBe("22:00");
  });
});

describe("scrim timers", () => {
  const start = new Date("2026-10-16T19:00:00Z");
  const base = { startsAt: start, dropsUnlockedAt: null, dropsLockedAt: null, remind30At: null, remind5At: null };
  const tpl = { dropsGroupId: "-100", dropsUnlockLeadMinutes: 90 };
  const at = (min: number) => new Date(start.getTime() + min * 60_000);
  it("unlocks drops 90 minutes before and locks at start", () => {
    expect(dueScrimActions(base, tpl, at(-91))).toEqual([]);
    expect(dueScrimActions(base, tpl, at(-90))).toEqual(["unlockDrops"]);
    expect(dueScrimActions({ ...base, dropsUnlockedAt: at(-90) }, tpl, at(0))).toContain("lockDrops");
    expect(dueScrimActions(base, { ...tpl, dropsGroupId: null }, at(-60))).toEqual([]);
  });
  it("sends 30 and 5 minute reminders once", () => {
    expect(dueScrimActions(base, tpl, at(-30))).toContain("remind30");
    const after30 = { ...base, dropsUnlockedAt: at(-90), remind30At: at(-30) };
    expect(dueScrimActions(after30, tpl, at(-5))).toEqual(["remind5"]);
    expect(dueScrimActions({ ...after30, remind5At: at(-5) }, tpl, at(-3))).toEqual([]);
    expect(dueScrimActions(base, tpl, at(-4))).toEqual(expect.arrayContaining(["skip30", "remind5"]));
  });
  it("ignores stale scrims", () => {
    expect(dueScrimActions(base, tpl, at(7 * 60))).toEqual([]);
  });
  it("auto-opens a scheduled scrim at the lead time, once", () => {
    const schedule = { scheduleEnabled: true, scheduleTime: "22:00", scheduleKind: "GULF", scheduleOpenLeadMinutes: 180, scheduleLastRunKey: null };
    expect(dueScheduledOpen(schedule, new Date("2026-10-16T15:59:00Z"))).toBeNull();
    const due = dueScheduledOpen(schedule, new Date("2026-10-16T16:00:00Z"));
    expect(due?.startsAt.toISOString()).toBe("2026-10-16T19:00:00.000Z");
    expect(dueScheduledOpen({ ...schedule, scheduleLastRunKey: due!.key }, new Date("2026-10-16T16:01:00Z"))).toBeNull();
    expect(dueScheduledOpen({ ...schedule, scheduleEnabled: false }, new Date("2026-10-16T16:00:00Z"))).toBeNull();
  });
  it("parses /scrim_schedule", () => {
    expect(parseScheduleCommand("22:00 خليجي 18 3 فتح 120")).toEqual({
      time: "22:00", kind: "GULF", maxTeams: 18, roomCount: 3, openLeadMinutes: 120,
    });
    expect(parseScheduleCommand("9:30 europe")).toEqual({ time: "09:30", kind: "EUROPE", maxTeams: 16, roomCount: 1 });
    expect(parseScheduleCommand("خليجي")).toBeNull();
  });
});
