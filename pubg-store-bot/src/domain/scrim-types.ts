export type ScrimKind = "EUROPE" | "GULF";
export type ScrimStatus = "DRAFT" | "OPEN" | "LOCKED" | "LIVE" | "DONE" | "CANCELED";
export type ScrimTeamStatus =
  | "PENDING_PROOF"
  | "WAITING_COMMIT"
  | "CONFIRMED"
  | "WAITLIST"
  | "REJECTED"
  | "WITHDRAWN"
  | "NO_SHOW";

export const ALLOWED_MAX_TEAMS = [16, 18] as const;
/** Any team count from MIN_MAX_TEAMS to MAX_MAX_TEAMS is allowed (16/18 are just common). */
export const MIN_MAX_TEAMS = 2;
export const MAX_MAX_TEAMS = 25;
export type AllowedMaxTeams = number;

export interface ScrimScoring {
  placement: Record<string, number>;
  killPoints: number;
}

export interface ScrimStandingRow {
  place: number;
  tag: string;
  kills: number;
}

export interface ScrimTopKiller {
  name: string;
  tag: string;
  kills: number;
}

export interface ScrimRoomResult {
  rows: ScrimStandingRow[];
  topKiller: ScrimTopKiller | null;
}

export interface ScrimOpenExtract {
  kind: ScrimKind | null;
  timeLabel: string | null;
  maxTeams: AllowedMaxTeams | null;
  roomCount: number | null;
  roomSecret: string | null;
  rules: string | null;
  /** Map per room in order, e.g. ["Rondo","Miramar","Erangel","Rondo"]. */
  maps?: string[];
}

export interface RoomCredentials {
  roomId: string;
  password: string;
}

export interface TeamScore {
  tag: string;
  points: number;
  kills: number;
  placements: number[];
}

export const DEFAULT_SCORING: ScrimScoring = {
  placement: { "1": 10, "2": 6, "3": 5, "4": 4, "5": 3 },
  killPoints: 1,
};

export function kindLabel(kind: ScrimKind): string {
  return kind === "GULF" ? "خليجي" : "أوروبي";
}

export function parseMaxTeams(value: unknown): AllowedMaxTeams | null {
  const n = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (Number.isInteger(n) && n >= MIN_MAX_TEAMS && n <= MAX_MAX_TEAMS) return n;
  return null;
}

export function parseRoomCount(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isInteger(n) || n < 1 || n > 8) return null;
  return n;
}

export function parseScoring(raw: unknown): ScrimScoring {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SCORING, placement: { ...DEFAULT_SCORING.placement } };
  const obj = raw as Record<string, unknown>;
  const placement =
    obj.placement && typeof obj.placement === "object"
      ? Object.fromEntries(
          Object.entries(obj.placement as Record<string, unknown>)
            .map(([key, value]) => [key, Number(value)])
            .filter(([, value]) => Number.isFinite(value)),
        )
      : { ...DEFAULT_SCORING.placement };
  const killPoints = Number(obj.killPoints);
  return {
    placement: Object.keys(placement).length ? placement : { ...DEFAULT_SCORING.placement },
    killPoints: Number.isFinite(killPoints) ? killPoints : DEFAULT_SCORING.killPoints,
  };
}
