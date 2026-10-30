/** Pure helpers for the organizers-group review flow (no LLM, no I/O). */

export type GroupReviewDecision = "accept" | "reject";

const ACCEPT_WORDS = new Set(["تم", "قبول", "مقبول", "ok", "okay"]);
const REJECT_WORDS = new Set(["رفض", "مرفوض"]);

/** Parses a short organizer reply like «تم», «تم ✅», «قبول», «ok», «رفض». Anything else → null. */
export function parseGroupReviewReply(text: string | undefined | null): GroupReviewDecision | null {
  if (!text) return null;
  const cleaned = text
    .replace(/[\u2705\u2714\u2611\u274C\u274E\u2716\uFE0F\u{1F44D}\u{1F44E}]/gu, " ")
    .replace(/[.!،,]+/g, " ")
    .trim()
    .toLowerCase();
  if (!cleaned || cleaned.split(/\s+/).length > 1) return null;
  if (ACCEPT_WORDS.has(cleaned)) return "accept";
  if (REJECT_WORDS.has(cleaned)) return "reject";
  return null;
}

type MarkupLike = { inline_keyboard?: Array<Array<{ callback_data?: string }>> } | undefined | null;

/** Recovers the team id from the ✅/❌ buttons attached to a registration card. */
export function teamIdFromReviewMarkup(markup: MarkupLike): string | null {
  for (const row of markup?.inline_keyboard ?? []) {
    for (const button of row) {
      const match = button.callback_data?.match(/^sc:(?:ok|no):(.+)$/);
      if (match) return match[1];
    }
  }
  return null;
}

/** Normalizes a Telegram group chat id (e.g. -1001234567890). */
export function parseGroupChatId(text: string): string | null {
  const match = text.trim().match(/^-\d{5,20}$/);
  return match ? match[0] : null;
}

/** Accepts t.me / telegram.me / https links only. */
export function parseDropsLink(text: string): string | null {
  const raw = text.trim();
  const withScheme = /^https?:\/\//i.test(raw) ? raw : /^(t\.me|telegram\.me)\//i.test(raw) ? `https://${raw}` : raw;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function isClearWord(text: string): boolean {
  return /^(off|حذف|الغاء|إلغاء|لا|-)$/i.test(text.trim());
}

export function withDropsLink(text: string, link: string | null | undefined): string {
  if (!link) return text;
  return `${text}\n\nقروب تحديد النزلات: ${link}`;
}

export function displayLeader(leader: { id: string; username?: string | null }): string {
  return leader.username ? `@${leader.username} (${leader.id})` : leader.id;
}
