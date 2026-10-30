/** Letter + digits, e.g. A001, F1442 (case-insensitive). */
const SHORT_CODE_RE = /\b([A-Za-z])(\d{1,6})\b/;
/** Channel-style hash ids, e.g. #6930 */
const HASH_CODE_RE = /#(\d{1,8})\b/;

export function formatShortCode(seq: number, prefix = "A"): string {
  if (!Number.isInteger(seq) || seq <= 0) {
    throw new Error(`invalid listing sequence: ${seq}`);
  }
  const p = (prefix || "A").trim().toUpperCase().charAt(0) || "A";
  if (!/^[A-Z]$/.test(p)) {
    throw new Error(`invalid listing prefix: ${prefix}`);
  }
  return `${p}${String(seq).padStart(3, "0")}`;
}

/** Normalize letter+digit codes (A1 → A001, f1442 → F1442). */
export function normalizeShortCode(input: string): string | null {
  const match = input.trim().toUpperCase().match(SHORT_CODE_RE);
  if (!match) return null;
  const seq = Number(match[2]);
  if (!Number.isInteger(seq) || seq <= 0) return null;
  return formatShortCode(seq, match[1]!);
}

/**
 * Ad identity for sync/sold: letter codes (F1442) or hash ids (#6930).
 * Letter codes are preferred when both appear.
 */
export function extractAdIdentity(input: string): string | null {
  const letter = normalizeShortCode(input);
  if (letter) return letter;
  const hash = input.match(HASH_CODE_RE);
  if (hash) return `#${hash[1]}`;
  return null;
}

export function parseShortCodeParts(
  code: string,
): { prefix: string; seq: number } | null {
  const normalized = normalizeShortCode(code);
  if (!normalized) return null;
  const match = normalized.match(/^([A-Z])(\d+)$/);
  if (!match) return null;
  return { prefix: match[1]!, seq: Number(match[2]) };
}

export function parseOwnerCommandPayload(text: string): string | null {
  const withoutCommand = text.replace(/^\/(?:sold|delete)(?:@\w+)?\s+/i, "");
  return normalizeShortCode(withoutCommand) ?? normalizeShortCode(text);
}

/** Parse `/sync_channel F1442` payload (optional code). */
export function parseSyncChannelPayload(text: string): string | null {
  const withoutCommand = text.replace(/^\/sync_channel(?:@\w+)?\s*/i, "").trim();
  if (!withoutCommand) return null;
  return extractAdIdentity(withoutCommand) ?? normalizeShortCode(withoutCommand);
}
