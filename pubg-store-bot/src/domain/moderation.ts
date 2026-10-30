import { normalizeShortCode } from "./short-code";

export interface BanTarget {
  listingCode?: string;
  telegramId?: string;
  reason?: string;
}

export function parseBanTarget(text: string): BanTarget | null {
  const body = text.replace(/^\/(?:ban|unban)(?:@\w+)?\s*/i, "").trim();
  if (!body) return null;
  const listingCode = normalizeShortCode(body);
  if (listingCode) {
    const reason = body.replace(/\bA\d{1,6}\b/i, "").trim() || undefined;
    return { listingCode, reason };
  }
  const idMatch = body.match(/^(\d{5,20})\s*(.*)$/);
  if (!idMatch) return null;
  return {
    telegramId: idMatch[1],
    reason: idMatch[2].trim() || undefined,
  };
}

export function startOfUtcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
