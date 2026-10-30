import { toWesternDigits } from "./scrim-time";

export type DropMap = "E" | "M";

export const DROP_SPOTS: Record<DropMap, readonly string[]> = {
  E: [
    "Pochinki", "School", "Rozhok", "Ruins", "Farm", "Mylta", "Shelter", "Prison", "Mansion", "Lipovka",
    "Mylta Power", "Novorepnoye", "Sosnovka Military Base", "Primorsk", "Quarry", "Gatka", "Hospital",
    "Georgopol", "Yasnaya Polyana", "Severny",
  ],
  M: [
    "Pecado", "San Martin", "Power Grid", "Los Leones", "Impala", "La Bendita", "Chumacera", "Monte Nuevo",
    "Valle del Mar", "El Pozo", "El Azahar", "Water Treatment", "Junkyard", "Crater Fields", "La Cobreria",
    "Cruz del Valle", "Puerto Paraiso", "Graveyard", "Campo Militar", "Ladrillera",
  ],
};

export const MAP_LABEL: Record<DropMap, string> = { E: "إرانغل", M: "ميرامار" };

export function spotName(map: DropMap, n: number): string {
  return DROP_SPOTS[map][n - 1] ?? String(n);
}

export interface DropClaim {
  team: string;
  E?: number;
  M?: number;
}

export type DropClaimParse = { ok: true; claim: DropClaim } | { ok: false; reason: "range" } | null;

/** Parses «TEAM | E:5 M:8» (':' or ';', any case, Arabic digits). Not a claim → null. */
export function parseDropClaim(raw: string): DropClaimParse {
  const text = toWesternDigits(raw).trim();
  const tokenRe = /(?:^|[\s|,])([EeMm])\s*[:;]\s*(\d{1,3})(?=$|[\s|,])/g;
  const found: Array<{ map: DropMap; n: number; index: number }> = [];
  for (const match of text.matchAll(tokenRe)) {
    found.push({ map: match[1].toUpperCase() as DropMap, n: Number(match[2]), index: match.index ?? 0 });
  }
  if (!found.length) return null;
  const firstIndex = found[0].index;
  const teamPart = (text.includes("|") ? text.split("|")[0] : text.slice(0, firstIndex)).trim();
  if (!teamPart) return null;
  const claim: DropClaim = { team: teamPart };
  for (const token of found) {
    if (token.n < 1 || token.n > 20) return { ok: false, reason: "range" };
    if (claim[token.map] !== undefined && claim[token.map] !== token.n) return { ok: false, reason: "range" };
    claim[token.map] = token.n;
  }
  return { ok: true, claim };
}

export interface DropsState {
  /** "E:5" → team tag */
  spots: Record<string, string>;
  /** team tag → its current picks */
  teams: Record<string, { E?: number; M?: number }>;
}

export function emptyDropsState(): DropsState {
  return { spots: {}, teams: {} };
}

export type DropDecision =
  | { kind: "ok"; state: DropsState; replaced: boolean }
  | { kind: "taken"; map: DropMap; n: number; owner: string }
  | { kind: "same" };

/** First-come wins; a team re-posting a different pick replaces its old one (freeing it). */
export function applyDropClaim(state: DropsState, tag: string, picks: { E?: number; M?: number }): DropDecision {
  const current = state.teams[tag] ?? {};
  const next = { ...current, ...picks };
  for (const map of ["E", "M"] as const) {
    const n = picks[map];
    if (n === undefined) continue;
    const owner = state.spots[`${map}:${n}`];
    if (owner && owner !== tag) return { kind: "taken", map, n, owner };
  }
  if (current.E === next.E && current.M === next.M && state.teams[tag]) return { kind: "same" };
  const spots = { ...state.spots };
  for (const map of ["E", "M"] as const) {
    if (picks[map] === undefined) continue;
    if (current[map] !== undefined) delete spots[`${map}:${current[map]}`];
    spots[`${map}:${picks[map]}`] = tag;
  }
  return {
    kind: "ok",
    state: { spots, teams: { ...state.teams, [tag]: next } },
    replaced: Boolean(state.teams[tag]),
  };
}

export function formatTeamDrops(picks: { E?: number; M?: number } | undefined): string {
  if (!picks) return "";
  const parts: string[] = [];
  if (picks.E !== undefined) parts.push(`${MAP_LABEL.E} ${picks.E} (${spotName("E", picks.E)})`);
  if (picks.M !== undefined) parts.push(`${MAP_LABEL.M} ${picks.M} (${spotName("M", picks.M)})`);
  return parts.join(" · ");
}
