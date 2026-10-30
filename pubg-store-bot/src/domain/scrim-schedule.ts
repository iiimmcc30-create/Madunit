import { nextDailyOccurrence, parseHhMm } from "./scrim-time";

const MIN = 60_000;
/** Ignore scrims whose start is long gone (bot was down, etc.). */
const STALE_AFTER_MS = 6 * 60 * MIN;

export type ScrimTimerAction = "unlockDrops" | "lockDrops" | "remind30" | "remind5" | "skip30";

export function dueScrimActions(
  scrim: {
    startsAt: Date | null;
    dropsUnlockedAt: Date | null;
    dropsLockedAt: Date | null;
    remind30At: Date | null;
    remind5At: Date | null;
  },
  template: { dropsGroupId: string | null; dropsUnlockLeadMinutes: number },
  now: Date,
): ScrimTimerAction[] {
  if (!scrim.startsAt) return [];
  const start = scrim.startsAt.getTime();
  const t = now.getTime();
  if (t > start + STALE_AFTER_MS) return [];
  const actions: ScrimTimerAction[] = [];
  if (template.dropsGroupId) {
    const lead = Math.max(0, template.dropsUnlockLeadMinutes) * MIN;
    if (!scrim.dropsUnlockedAt && t >= start - lead && t < start) actions.push("unlockDrops");
    if (!scrim.dropsLockedAt && t >= start) actions.push("lockDrops");
  }
  if (!scrim.remind30At) {
    if (t >= start - 30 * MIN && t < start - 5 * MIN) actions.push("remind30");
    else if (t >= start - 5 * MIN) actions.push("skip30");
  }
  if (!scrim.remind5At && t >= start - 5 * MIN && t < start + 5 * MIN) actions.push("remind5");
  return actions;
}

/** When a daily schedule should auto-open registration. Returns the start time and an idempotency key. */
export function dueScheduledOpen(
  template: {
    scheduleEnabled: boolean;
    scheduleTime: string | null;
    scheduleKind: string | null;
    scheduleOpenLeadMinutes: number;
    scheduleLastRunKey: string | null;
  },
  now: Date,
): { startsAt: Date; key: string } | null {
  if (!template.scheduleEnabled || !template.scheduleTime || !template.scheduleKind) return null;
  const hm = parseHhMm(template.scheduleTime);
  if (!hm) return null;
  const startsAt = nextDailyOccurrence(hm.hour, hm.minute, now);
  const key = startsAt.toISOString();
  if (template.scheduleLastRunKey === key) return null;
  if (now.getTime() < startsAt.getTime() - Math.max(0, template.scheduleOpenLeadMinutes) * MIN) return null;
  return { startsAt, key };
}

export interface ParsedSchedule {
  time: string;
  kind: "GULF" | "EUROPE";
  maxTeams: number;
  roomCount: number;
  openLeadMinutes?: number;
}

/** «/scrim_schedule 22:00 خليجي 16 3 فتح 180» */
export function parseScheduleCommand(raw: string): ParsedSchedule | null {
  const text = raw.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660)).trim();
  const time = text.match(/(\d{1,2}:\d{2})/)?.[1];
  const hm = time ? parseHhMm(time) : null;
  if (!time || !hm) return null;
  const kind = /(خليج|gulf)/i.test(text) ? "GULF" : /(أوروب|اوروب|europe)/i.test(text) ? "EUROPE" : null;
  if (!kind) return null;
  const lead = text.match(/(?:فتح|lead)\s*=?\s*(\d{1,4})/i);
  const rest = text.replace(time, " ").replace(lead?.[0] ?? "\u0000", " ");
  const numbers = [...rest.matchAll(/\b(\d{1,2})\b/g)].map((m) => Number(m[1]));
  const maxTeams = numbers.find((n) => n >= 10 && n <= 25) ?? 16;
  const roomCount = numbers.find((n) => n >= 1 && n <= 8) ?? 1;
  return {
    time: `${String(hm.hour).padStart(2, "0")}:${String(hm.minute).padStart(2, "0")}`,
    kind,
    maxTeams,
    roomCount,
    ...(lead ? { openLeadMinutes: Number(lead[1]) } : {}),
  };
}
