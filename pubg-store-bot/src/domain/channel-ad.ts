import { extractListedPrice, extractFields, type ExtractedFields } from "./extract";
import { extractAdIdentity, normalizeShortCode } from "./short-code";
import { mediaFromMessage } from "./traders-ad";

export interface ChannelAdExtract {
  shortCode: string | null;
  identity: string | null;
  description: string;
  price: number;
  extractedFields: ExtractedFields;
  media: { kind: "photo" | "video"; fileId: string } | null;
  looksLikeAd: boolean;
  looksSold: boolean;
}

const SOLD_RE = /(?:✅\s*)?(?:تم\s*البيع|مباع(?:ة)?|sold)(?=$|[^\p{L}\p{N}])/iu;
const LISTING_HINT_RE =
  /(?:رقم\s*الإعلان|العلان|حساب|ببجي|pubg|لفل|lvl|level|سعر|ربط|سكن|كونكر|#\d{2,}|[A-Za-z]\d{2,})/i;

/** True when caption/text looks like a channel listing ad (not a plain chat line). */
export function looksLikeChannelAd(caption: string, hasMedia: boolean): boolean {
  const text = (caption ?? "").trim();
  if (!text && !hasMedia) return false;
  if (extractAdIdentity(text)) return true;
  if (hasMedia && text.length >= 8 && LISTING_HINT_RE.test(text)) return true;
  if (hasMedia && text.length >= 20) return true;
  return false;
}

export function extractChannelAd(message: {
  caption?: string;
  text?: string;
  photo?: Array<{ file_id: string }>;
  video?: { file_id: string };
  animation?: { file_id: string };
  document?: { file_id: string; mime_type?: string };
}): ChannelAdExtract {
  const caption = (message.caption ?? message.text ?? "").replace(/\r\n/g, "\n").trim();
  const media = mediaFromMessage(message);
  const identity = extractAdIdentity(caption);
  const shortCode = normalizeShortCode(caption) ?? (identity && !identity.startsWith("#") ? identity : null);
  const price = extractListedPrice(caption) ?? 0;
  const extractedFields = extractFields(caption);
  const looksSold = SOLD_RE.test(caption);
  const looksLikeAd = looksLikeChannelAd(caption, Boolean(media)) || Boolean(shortCode);

  return {
    shortCode,
    identity,
    description: caption || (shortCode ? `إعلان ${shortCode}` : ""),
    price,
    extractedFields,
    media,
    looksLikeAd,
    looksSold,
  };
}
