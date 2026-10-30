import type { ExtractedFields } from "../domain/extract";

export interface PublicListing {
  shortCode: string;
  storeId: string;
  price: number;
  description: string;
  binding: string;
  level?: number;
  skins: string[];
  ownerUsername: string;
}

export function toPublicListing(input: {
  shortCode: string;
  storeId: string;
  price: number;
  description: string;
  ownerUsername: string;
  extractedFields?: ExtractedFields | null;
}): PublicListing {
  const fields = input.extractedFields ?? {};
  return {
    shortCode: input.shortCode,
    storeId: input.storeId,
    price: input.price,
    description: input.description,
    binding: fields.binding ?? "",
    level: fields.level,
    skins: fields.skins ?? [],
    ownerUsername: input.ownerUsername,
  };
}

export function formatPublicListing(listing: PublicListing): string {
  const bits = [
    listing.level ? `لفل ${listing.level}` : null,
    listing.skins.slice(0, 4).join(" · ") || null,
    listing.binding ? `ربط ${listing.binding}` : null,
  ].filter(Boolean);
  return [`${listing.shortCode} — ${listing.price} ريال`, bits.join(" · "), listing.description]
    .filter(Boolean)
    .join("\n");
}

const SELLER_LEAK = /(?:\bsellerId\b|\btelegramId\b|\bsellerTelegramId\b|05\d{8}|t\.me\/)/i;

export function stripSellerLeak(text: string, ownerUsername: string): string {
  const owner = ownerUsername.replace(/^@/, "");
  return text
    .replace(/@([A-Za-z0-9_]+)/g, (full, name: string) =>
      name.toLowerCase() === owner.toLowerCase() ? full : "@المالك",
    )
    .replace(/05\d{8}/g, "")
    .replace(/t\.me\/\S+/gi, "")
    .replace(/\bsellerId\b[:\s]*\S+/gi, "")
    .replace(/\bsellerTelegramId\b[:\s]*\S+/gi, "")
    .replace(/\btelegramId\b[:\s]*\S+/gi, "");
}

export function containsSellerLeak(text: string, ownerUsername: string): string | null {
  const owner = ownerUsername.replace(/^@/, "").toLowerCase();
  const mentions = [...text.matchAll(/@([A-Za-z0-9_]+)/g)].filter(
    (match) => match[1].toLowerCase() !== owner && match[1] !== "المالك",
  );
  if (mentions.length > 0) return mentions[0][0];
  if (SELLER_LEAK.test(text)) return "contact";
  return null;
}

export function safeAgentReply(text: string, ownerUsername: string): string {
  const cleaned = stripSellerLeak(text, ownerUsername).trim();
  if (!cleaned) {
    return "ما قدرت أصيغ رد واضح. حدد طلبك أو رقم الإعلان مثل A001. التسليم والشراء عبر المالك فقط.";
  }
  if (containsSellerLeak(text, ownerUsername) || containsSellerLeak(cleaned, ownerUsername)) {
    return "ما أقدر أكمل بهالرد. التسليم والشراء عبر المالك فقط. حدد طلبك أو رقم الإعلان.";
  }
  return cleaned;
}
