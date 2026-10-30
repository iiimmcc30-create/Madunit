import { describe, expect, it } from "vitest";
import {
  canTakeConfirmedSlot,
  confirmedCount,
  duplicateTag,
  firstWaitlist,
  nextRosterSlot,
  shouldLockRegistration,
  teamNeedsProof,
} from "./scrim-flow";
import type { ScrimTeamSlot } from "./scrim-flow";

const team = (
  partial: Partial<ScrimTeamSlot> & Pick<ScrimTeamSlot, "id" | "tag" | "status">,
): ScrimTeamSlot => ({
  rosterSlot: null,
  waitlistSlot: null,
  ...partial,
});

describe("scrim lock and waitlist", () => {
  it("locks at 16 and 18", () => {
    const sixteen = Array.from({ length: 16 }, (_, i) =>
      team({ id: `t${i}`, tag: `T${i}`, status: "CONFIRMED", rosterSlot: i + 1 }),
    );
    expect(shouldLockRegistration(sixteen, 16)).toBe(true);
    expect(shouldLockRegistration(sixteen.slice(0, 15), 16)).toBe(false);
    expect(shouldLockRegistration(sixteen, 18)).toBe(false);
    const eighteen = [
      ...sixteen,
      team({ id: "a", tag: "A", status: "CONFIRMED", rosterSlot: 17 }),
      team({ id: "b", tag: "B", status: "CONFIRMED", rosterSlot: 18 }),
    ];
    expect(shouldLockRegistration(eighteen, 18)).toBe(true);
    expect(confirmedCount(eighteen)).toBe(18);
  });

  it("promotes the first waitlist slot", () => {
    const teams = [
      team({ id: "1", tag: "AAA", status: "CONFIRMED", rosterSlot: 1 }),
      team({ id: "2", tag: "BBB", status: "WAITLIST", waitlistSlot: 2 }),
      team({ id: "3", tag: "CCC", status: "WAITLIST", waitlistSlot: 1 }),
    ];
    expect(firstWaitlist(teams)?.tag).toBe("CCC");
    expect(nextRosterSlot(teams)).toBe(2);
    expect(canTakeConfirmedSlot(teams, 16)).toBe(true);
  });

  it("blocks duplicate tags and requires proof for new or absent teams", () => {
    const teams = [team({ id: "1", tag: "AAA", status: "CONFIRMED" })];
    expect(duplicateTag(teams, "AAA")).toBe(true);
    expect(duplicateTag(teams, "BBB")).toBe(false);
    expect(teamNeedsProof(null)).toBe(true);
    expect(teamNeedsProof({ attended: 2, absent: 0 })).toBe(false);
    expect(teamNeedsProof({ attended: 2, absent: 1 })).toBe(true);
  });
});
