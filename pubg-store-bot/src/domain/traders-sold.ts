import { escapeHtml } from "./caption";
import { extractAdIdentity } from "./short-code";

const SOLD_PHRASE_RE = /(?:^|[^\p{L}\p{N}])(?:تم\s*البيع|تم\s*بيعه|مباع(?:ة|ه)?|مبيوع(?:ة|ه)?|انباع(?:ت)?|sold)(?=$|[^\p{L}\p{N}])/iu;
/** Telegram HTML <s>, markdown ~~, or Unicode long-strikethrough (U+0336). */
const STRIKE_HTML_RE = /<\/?s\b[^>]*>/i;
const STRIKE_MD_RE = /~~.+~~/s;
const STRIKE_COMBINING_RE = /\u0336/;

/** Minimal Telegram MessageEntity shape we care about. */
export type TextEntityLike = { type: string; offset: number; length: number };
/** Alias used by traders-mirror handler. */
export type SoldEntity = TextEntityLike;

const MEANINGFUL_STRIKE_LEN = 3;

export function hasSoldPhrase(text: string): boolean {
  return SOLD_PHRASE_RE.test(text ?? "");
}

/**
 * True if Telegram strikethrough entities cover a meaningful span,
 * or plain-text markers (HTML <s>, ~~md~~, U+0336) are present.
 * Spoiler entities are intentionally ignored.
 */
export function hasHeavyStrikethrough(
  text: string,
  entities?: TextEntityLike[] | null,
): boolean {
  const t = text ?? "";
  if (entities?.length) {
    let covered = 0;
    for (const e of entities) {
      if (e?.type === "strikethrough" && e.length > 0) {
        covered += e.length;
        if (e.length >= MEANINGFUL_STRIKE_LEN || covered >= MEANINGFUL_STRIKE_LEN) {
          return true;
        }
      }
    }
  }
  return STRIKE_HTML_RE.test(t) || STRIKE_MD_RE.test(t) || STRIKE_COMBINING_RE.test(t);
}

/**
 * Sold notice if explicit sold phrase, or heavy strikethrough on a listing-like line.
 * Prefer phrase; strikethrough alone is enough when an ad identity is present.
 */
export function detectTradersSold(
  text: string,
  entities?: TextEntityLike[] | null,
): boolean {
  const t = (text ?? "").trim();
  if (!t && !(entities?.some((e) => e.type === "strikethrough"))) return false;
  if (t && hasSoldPhrase(t)) return true;
  // Strike alone: enough with ad identity OR a non-trivial listing caption
  // (old pre-bot ads often have no short code — still must not republish).
  if (hasHeavyStrikethrough(t, entities)) {
    if (extractAdIdentity(t)) return true;
    if (t.length >= 12) return true;
  }
  return false;
}

/** Strip strike markers / sold footer for a clean reference line. */
export function cleanSoldReferenceText(text: string, maxLen = 120): string {
  let t = (text ?? "").replace(/\r\n/g, "\n");
  t = t.replace(/<\/?s\b[^>]*>/gi, "");
  t = t.replace(/~~/g, "");
  t = t.replace(/\u0336/g, "");
  t = t.replace(/(?:✅\s*)?(?:تم\s*البيع|تم\s*بيعه|مباع(?:ة|ه)?|مبيوع(?:ة|ه)?|انباع(?:ت)?|sold)(?:\s*✅)?\s*/giu, "");
  t = t.replace(/\n{2,}/g, "\n").trim();
  const first = t.split("\n").map((l) => l.trim()).filter(Boolean)[0] ?? t;
  if (first.length <= maxLen) return first;
  return `${first.slice(0, maxLen - 1)}…`;
}

/**
 * Full channel caption → HTML strikethrough of previous caption + newline + «تم البيع ✅».
 * Pass `{ alreadyEscaped: true }` when caption came from rewriteTradersCaption.
 */
export function formatStruckSoldCaption(
  caption: string,
  opts?: { alreadyEscaped?: boolean; maxLen?: number },
): string {
  const maxLen = opts?.maxLen ?? 1024;
  let t = (caption ?? "").replace(/\r\n/g, "\n");
  t = t.replace(/<\/?s\b[^>]*>/gi, "");
  t = t.replace(/~~/g, "");
  t = t.replace(/\u0336/g, "");
  t = t.replace(/\n?(?:✅\s*)?(?:تم\s*البيع|مباع(?:ة)?|sold)(?:\s*✅)?\s*$/gim, "");
  t = t.replace(/\n{3,}/g, "\n\n").trim();
  const body = opts?.alreadyEscaped ? t : escapeHtml(t);
  // Same channel post: strikethrough full caption + append «تم البيع ✅» (not struck)
  const footer = "\nتم البيع ✅";
  const overhead = "<s>".length + "</s>".length + footer.length;
  let clipped = body;
  if (clipped.length + overhead > maxLen) {
    clipped = `${clipped.slice(0, Math.max(0, maxLen - overhead - 1))}…`;
  }
  return `<s>${clipped}</s>${footer}`;
}

/**
 * Build the caption written onto the mirrored channel ad when sold.
 * Prefer a full listing caption; falls back to a short ref line.
 */
export function formatChannelSoldCaption(
  captionOrRef: string,
  identity?: string | null,
  opts?: { alreadyEscaped?: boolean },
): string {
  const raw = (captionOrRef ?? "").trim();
  if (raw) return formatStruckSoldCaption(raw, opts);
  return formatStruckSoldCaption(identity || "الإعلان", { alreadyEscaped: false });
}

/** Channel sold notice in the user's style: strikethrough ref + تم البيع ✅ */
export function formatChannelSoldNotice(refText: string, identity?: string | null): string {
  const cleaned = cleanSoldReferenceText(refText);
  const line =
    cleaned ||
    (identity ? String(identity) : "الإعلان");
  return `<s>${escapeHtml(line)}</s>\nتم البيع ✅`;
}

/** Standalone channel thank-you / sold notice (not a reply on the ad). */
export function formatChannelSoldThankYou(identity?: string | null): string {
  const id = (identity ?? "").trim();
  if (id) {
    return `✅ تم البيع\nشكرًا — ${escapeHtml(id)}`;
  }
  return "✅ تم البيع\nشكرًا";
}

/** @deprecated use formatChannelSoldThankYou */
export function formatChannelSoldReply(): string {
  return formatChannelSoldThankYou();
}

export function extractSoldIdentity(text: string): string | null {
  return extractAdIdentity(text);
}
