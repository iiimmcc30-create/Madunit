import type { ScrimKind } from "./scrim-types";
import { DEFAULT_SCORING, kindLabel } from "./scrim-types";

export const DEFAULT_COMMITTED_PHRASE = "ملتزمين";

export const DEFAULT_OPEN_CAPTION_EUROPE = `🏁 سكرم {النوع}
الوقت: {الوقت}
عدد الفرق: {عدد_الفرق}
عدد الرومات: {عدد_الرومات}

الشروط:
{الشروط}

التسجيل من الزر تحت 👇`;

export const DEFAULT_OPEN_CAPTION_GULF = `🏁 سكرم {النوع}
الوقت: {الوقت}
عدد الفرق: {عدد_الفرق}
عدد الرومات: {عدد_الرومات}

الشروط:
{الشروط}

التسجيل من الزر تحت 👇`;

export const DEFAULT_RULES = `الالتزام بالوقت
ممنوع الغش والاستبدال بعد القفل
التاق واضح وثابت طول السكرم
اللي أول مرة يلعب معنا يرسل صورة قروب الإيسبورت أو الحساب للتحقق`;

export const DEFAULT_COMMIT_ACK = `تم تسجيل التزامك ✅
الرقم السري للروم: {السر}
انتظر آيدي الروم هنا قبل الستارت.`;

export const DEFAULT_LOCK_TEXT = `تم قفل التسجيل ✅
اكتمل العدد ({عدد_الفرق} تيم).`;

export const DEFAULT_ROSTER_TEMPLATE = `📋 لستة فرق سكرم {النوع}
الوقت: {الوقت}

الشروط:
{الشروط}

{اللستة}`;

export const DEFAULT_ROOM_ID_TEXT = `آيدي الروم: {id}
الباسورد: {pass}
استعجلوا قبل الستارت ⏱️`;

export const DEFAULT_ROOM_RESULT_TEMPLATE = `🏆 نتائج الروم {رقم_الروم}

المركز الأول: {الأول}
أكثر لاعب كيلات: {أكثر_كيلات} ({عدد_الكيلات})

الترتيب:
{الخمسة}`;

export const DEFAULT_THANKS_TEXT = `شكرًا لكل الفرق اللي حضرت 💛
نراكم في السكرم الجاي.`;

export function defaultScrimTemplateFields() {
  return {
    openCaptionEurope: DEFAULT_OPEN_CAPTION_EUROPE,
    openCaptionGulf: DEFAULT_OPEN_CAPTION_GULF,
    defaultRules: DEFAULT_RULES,
    commitAckText: DEFAULT_COMMIT_ACK,
    committedPhrase: DEFAULT_COMMITTED_PHRASE,
    lockText: DEFAULT_LOCK_TEXT,
    rosterTemplate: DEFAULT_ROSTER_TEMPLATE,
    roomIdText: DEFAULT_ROOM_ID_TEXT,
    roomResultTemplate: DEFAULT_ROOM_RESULT_TEMPLATE,
    thanksText: DEFAULT_THANKS_TEXT,
    scoring: { ...DEFAULT_SCORING, placement: { ...DEFAULT_SCORING.placement } },
  };
}

export function renderScrimTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const value = vars[key];
    return value !== undefined ? value : `{${key}}`;
  });
}

export function openCaptionFor(kind: ScrimKind, europe: string, gulf: string): string {
  return kind === "GULF" ? gulf || DEFAULT_OPEN_CAPTION_GULF : europe || DEFAULT_OPEN_CAPTION_EUROPE;
}

export const DEFAULT_ROSTER_LINE = "{n}- {team}";

export function formatRosterLines(
  tags: Array<{ slot: number; tag: string }>,
  options: { lineFormat?: string; startSlot?: number; totalSlots?: number; showEmpty?: boolean } = {},
): string {
  const format = options.lineFormat || DEFAULT_ROSTER_LINE;
  const line = (n: number, team: string) =>
    format.replace(/\{n\}/g, String(n)).replace(/\{team\}/g, team).replace(/\s+$/, "");
  if (options.showEmpty && options.totalSlots) {
    const start = Math.max(1, options.startSlot ?? 1);
    const bySlot = new Map(tags.map((row) => [row.slot, row.tag]));
    const extra = [...bySlot.keys()].filter((slot) => slot < start || slot >= start + options.totalSlots!);
    const slots = [...Array.from({ length: options.totalSlots }, (_, i) => start + i), ...extra].sort((a, b) => a - b);
    return slots.map((n) => line(n, bySlot.get(n) ?? "")).join("\n");
  }
  return [...tags]
    .sort((a, b) => a.slot - b.slot)
    .map((row) => line(row.slot, row.tag))
    .join("\n");
}

export function openTemplateVars(input: {
  kind: ScrimKind;
  timeLabel: string;
  maxTeams: number;
  roomCount: number;
  rules: string;
  maps?: readonly string[];
  dayLabel?: string;
}): Record<string, string> {
  return {
    الخرائط: (input.maps ?? []).join(", "),
    اليوم: input.dayLabel ?? "",
    النوع: kindLabel(input.kind),
    الوقت: input.timeLabel,
    عدد_الفرق: String(input.maxTeams),
    عدد_الرومات: String(input.roomCount),
    الشروط: input.rules,
  };
}

/** «16 Oct» style day label in Riyadh time. */
export function dayLabel(date: Date | null | undefined): string {
  if (!date) return "";
  const shifted = new Date(date.getTime() + 180 * 60_000);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${shifted.getUTCDate()} ${months[shifted.getUTCMonth()]}`;
}
