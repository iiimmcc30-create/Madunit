import { MAX_MAX_TEAMS, MIN_MAX_TEAMS, type AllowedMaxTeams, type ScrimTeamStatus } from "./scrim-types";

export interface ScrimTeamSlot {
  id: string;
  tag: string;
  status: ScrimTeamStatus;
  rosterSlot: number | null;
  waitlistSlot: number | null;
}

export function isAllowedMaxTeams(value: number): value is AllowedMaxTeams {
  return Number.isInteger(value) && value >= MIN_MAX_TEAMS && value <= MAX_MAX_TEAMS;
}

export function confirmedCount(teams: Array<{ status: ScrimTeamStatus }>): number {
  return teams.filter((team) => team.status === "CONFIRMED").length;
}

export function shouldLockRegistration(teams: Array<{ status: ScrimTeamStatus }>, maxTeams: number): boolean {
  return confirmedCount(teams) >= maxTeams;
}

export function nextRosterSlot(
  teams: Array<{ rosterSlot: number | null; status: ScrimTeamStatus }>,
  startSlot = 1,
): number {
  const used = new Set(
    teams.filter((team) => team.status === "CONFIRMED" && team.rosterSlot != null).map((team) => team.rosterSlot!),
  );
  let slot = Math.max(1, startSlot);
  while (used.has(slot)) slot += 1;
  return slot;
}

export function nextWaitlistSlot(teams: Array<{ waitlistSlot: number | null; status: ScrimTeamStatus }>): number {
  const used = teams
    .filter((team) => team.status === "WAITLIST" && team.waitlistSlot != null)
    .map((team) => team.waitlistSlot as number);
  return (used.length ? Math.max(...used) : 0) + 1;
}

export function firstWaitlist(teams: ScrimTeamSlot[]): ScrimTeamSlot | null {
  return (
    [...teams]
      .filter((team) => team.status === "WAITLIST")
      .sort((a, b) => (a.waitlistSlot ?? 999) - (b.waitlistSlot ?? 999) || a.tag.localeCompare(b.tag))[0] ?? null
  );
}

export function teamNeedsProof(record: { attended: number; absent: number } | null): boolean {
  if (!record) return true;
  if (record.absent > 0) return true;
  return record.attended < 1;
}

export function registrationOpen(status: string): boolean {
  return status === "OPEN";
}

export function canTakeConfirmedSlot(teams: Array<{ status: ScrimTeamStatus }>, maxTeams: number): boolean {
  return confirmedCount(teams) < maxTeams;
}

export function duplicateTag(
  teams: Array<{ id?: string; tag: string; status: ScrimTeamStatus }>,
  tag: string,
  exceptId?: string,
): boolean {
  return teams.some(
    (team) =>
      team.tag === tag &&
      team.status !== "REJECTED" &&
      team.status !== "WITHDRAWN" &&
      (!exceptId || team.id !== exceptId),
  );
}

export function activeLeaderTeam(
  teams: Array<{ id?: string; leaderTelegramId: string; status: ScrimTeamStatus }>,
  leaderTelegramId: string,
): boolean {
  return teams.some(
    (team) =>
      team.leaderTelegramId === leaderTelegramId &&
      team.status !== "REJECTED" &&
      team.status !== "WITHDRAWN" &&
      team.status !== "NO_SHOW",
  );
}
