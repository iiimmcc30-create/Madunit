import { parseScoring, type ScrimRoomResult, type ScrimScoring, type TeamScore } from "./scrim-types";

export function scoreRoomResult(result: ScrimRoomResult, scoringInput?: unknown): Map<string, TeamScore> {
  const scoring = parseScoring(scoringInput);
  const out = new Map<string, TeamScore>();
  for (const row of result.rows) {
    const placement = scoring.placement[String(row.place)] ?? 0;
    const points = placement + row.kills * scoring.killPoints;
    out.set(row.tag, {
      tag: row.tag,
      points,
      kills: row.kills,
      placements: [row.place],
    });
  }
  return out;
}

export function accumulateTeamScores(rooms: ScrimRoomResult[], scoringInput?: unknown): TeamScore[] {
  const totals = new Map<string, TeamScore>();
  for (const room of rooms) {
    const scored = scoreRoomResult(room, scoringInput);
    for (const row of scored.values()) {
      const prev = totals.get(row.tag);
      if (!prev) {
        totals.set(row.tag, { ...row, placements: [...row.placements] });
        continue;
      }
      prev.points += row.points;
      prev.kills += row.kills;
      prev.placements.push(...row.placements);
    }
  }
  return [...totals.values()].sort((a, b) => b.points - a.points || b.kills - a.kills || a.tag.localeCompare(b.tag));
}

export function formatRanking(scores: TeamScore[]): string {
  return scores
    .map((row, index) => `${index + 1}- ${row.tag}  ${row.points} نقطة  (${row.kills} كيل)`)
    .join("\n");
}

export function parseScoringConfig(raw: unknown): ScrimScoring {
  return parseScoring(raw);
}
