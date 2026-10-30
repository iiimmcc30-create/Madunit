/** Scrim times are in Asia/Riyadh (UTC+3, no DST). */
export const RIYADH_OFFSET_MINUTES = 180;

export function toWesternDigits(text: string): string {
  return text
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

function riyadhParts(now: Date) {
  const shifted = new Date(now.getTime() + RIYADH_OFFSET_MINUTES * 60_000);
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth(), d: shifted.getUTCDate() };
}

function riyadhDate(y: number, m: number, d: number, hour: number, minute: number): Date {
  return new Date(Date.UTC(y, m, d, hour, minute) - RIYADH_OFFSET_MINUTES * 60_000);
}

/** Next occurrence (today or tomorrow) of HH:MM Riyadh time that is strictly after `after`. */
export function nextDailyOccurrence(hour: number, minute: number, after: Date): Date {
  const { y, m, d } = riyadhParts(after);
  const today = riyadhDate(y, m, d, hour, minute);
  if (today.getTime() > after.getTime()) return today;
  return riyadhDate(y, m, d + 1, hour, minute);
}

export function parseHhMm(text: string): { hour: number; minute: number } | null {
  const match = toWesternDigits(text.trim()).match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/**
 * Best-effort start time from a free-text label like «10 الليلة», «22:00», «9:30 م», «الساعة 11».
 * Bare hours 1–11 without a morning marker are treated as evening (scrims run at night).
 * Returns null when no clock time is found.
 */
export function parseScrimStartTime(label: string, now: Date): Date | null {
  const text = toWesternDigits(label);
  const match = text.match(/(?:^|[^\d])(\d{1,2})(?:[:.](\d{2}))?(?!\d)/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  if (hour > 23 || minute > 59) return null;
  const morning = /(صباح|الصبح|فجر|ص(?:\s|$)|\bam\b)/i.test(text);
  const evening = /(مساء|مسا|الليل|ليل|العصر|عصر|المغرب|العشاء|م(?:\s|$)|\bpm\b)/i.test(text);
  if (hour === 12 && morning) hour = 0;
  else if (hour >= 1 && hour <= 11 && (evening || !morning)) hour += 12;
  // a few minutes of slack so "now-ish" labels still count as today
  return nextDailyOccurrence(hour, minute, new Date(now.getTime() - 10 * 60_000));
}

export function formatRiyadhTime(date: Date): string {
  const shifted = new Date(date.getTime() + RIYADH_OFFSET_MINUTES * 60_000);
  const hh = String(shifted.getUTCHours()).padStart(2, "0");
  const mm = String(shifted.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
