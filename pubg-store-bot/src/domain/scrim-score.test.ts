import { describe, expect, it } from "vitest";
import { accumulateTeamScores, scoreRoomResult } from "./scrim-score";
import type { ScrimRoomResult } from "./scrim-types";

const room1: ScrimRoomResult = {
  rows: [
    { place: 1, tag: "AAA", kills: 10 },
    { place: 2, tag: "BBB", kills: 4 },
    { place: 3, tag: "CCC", kills: 2 },
  ],
  topKiller: { name: "x", tag: "AAA", kills: 10 },
};

const room2: ScrimRoomResult = {
  rows: [
    { place: 1, tag: "BBB", kills: 6 },
    { place: 2, tag: "AAA", kills: 3 },
    { place: 3, tag: "CCC", kills: 1 },
  ],
  topKiller: { name: "y", tag: "BBB", kills: 6 },
};

describe("scrim scoring", () => {
  it("adds placement points plus kills", () => {
    const scored = scoreRoomResult(room1);
    expect(scored.get("AAA")?.points).toBe(20);
    expect(scored.get("BBB")?.points).toBe(10);
  });

  it("ranks teams across rooms", () => {
    const ranked = accumulateTeamScores([room1, room2]);
    expect(ranked[0]?.tag).toBe("AAA");
    expect(ranked[0]?.points).toBe(20 + 9);
    expect(ranked[1]?.tag).toBe("BBB");
  });

  it("uses custom scoring when provided", () => {
    const scored = scoreRoomResult(room1, { placement: { "1": 15 }, killPoints: 0 });
    expect(scored.get("AAA")?.points).toBe(15);
    expect(scored.get("BBB")?.points).toBe(0);
  });
});
