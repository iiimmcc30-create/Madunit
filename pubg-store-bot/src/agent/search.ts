import type { GlossaryEntry } from "../domain/glossary";
import { normalizeDigits } from "../domain/digits";
import type { ExtractedFields } from "../domain/extract";
import { formatPublicListing, toPublicListing, type PublicListing } from "./public-listing";

export interface ListingSearchFilters {
  query?: string;
  maxPrice?: number;
  minPrice?: number;
  skins?: string[];
  binding?: string;
  limit?: number;
}

const META_GLOSSARY = /^(الربط|ربط |أول إيميل|مربوط|مفكوك|مقبول|صافي|تفاوض|آخر سعر|وكالة|وسيط|لفل)/i;

export function parseSearchFilters(text: string, glossary: GlossaryEntry[]): ListingSearchFilters {
  const normalized = normalizeDigits(text);
  const maxMatch = normalized.match(
    /(?:أقل من|اقل من|تحت|بأقل من|باقل من|ما يتجاوز|ميزانية(?:\s*[:\-])?|under)\s*(\d{2,6})/i,
  );
  const minMatch = normalized.match(/(?:فوق|أكثر من|اكثر من)\s*(\d{2,6})/i);
  const skins: string[] = [];
  for (const entry of glossary) {
    if (META_GLOSSARY.test(entry.term)) continue;
    const keys = [entry.term, ...(entry.aliases ?? [])];
    if (keys.some((key) => key.length >= 2 && normalized.toLowerCase().includes(key.toLowerCase()))) {
      skins.push(entry.term);
    }
  }
  let binding: string | undefined;
  if (/(مفكوك|ضيف|guest)/i.test(normalized)) binding = "مفكوك";
  else if (/(فيس|فيسبوك|facebook)/i.test(normalized)) binding = "فيس";
  else if (/(جوجل|google)/i.test(normalized)) binding = "جوجل";
  else if (/(تويتر|twitter)/i.test(normalized)) binding = "تويتر";
  else if (/(أبل|ابل|apple)/i.test(normalized)) binding = "أبل";
  else if (/(أول إيميل|اول ايميل)/i.test(normalized)) binding = "أول إيميل";
  else if (/(إيميل|ايميل|email)/i.test(normalized)) binding = "إيميل";

  return {
    query: text.trim(),
    maxPrice: maxMatch ? Number(maxMatch[1]) : undefined,
    minPrice: minMatch ? Number(minMatch[1]) : undefined,
    skins: skins.length ? skins : undefined,
    binding,
    limit: 3,
  };
}

export interface SearchableListing {
  shortCode: string;
  storeId: string;
  price: number;
  description: string;
  ownerUsername: string;
  extractedFields?: ExtractedFields | null;
}

export function scoreListing(
  listing: SearchableListing,
  filters: ListingSearchFilters,
  glossary: GlossaryEntry[],
): number {
  if (filters.maxPrice != null && listing.price > filters.maxPrice) return -1;
  if (filters.minPrice != null && listing.price < filters.minPrice) return -1;
  const fields = listing.extractedFields ?? {};
  if (filters.binding) {
    const have = (fields.binding ?? "").toLowerCase();
    if (!have.includes(filters.binding.toLowerCase()) && !listing.description.toLowerCase().includes(filters.binding.toLowerCase())) {
      return -1;
    }
  }
  const haystack = normalizeDigits(
    [
      listing.shortCode,
      listing.description,
      fields.binding ?? "",
      String(fields.level ?? ""),
      ...(fields.skins ?? []),
      ...(fields.upgradedWeapons ?? []),
    ]
      .join(" ")
      .toLowerCase(),
  );
  let score = 1;
  const wantedSkins = filters.skins ?? [];
  if (wantedSkins.length > 0) {
    const skinHits = wantedSkins.filter((skin) => haystack.includes(skin.toLowerCase()));
    if (skinHits.length === 0) return -1;
    score += skinHits.length * 4;
  }
  const query = filters.query?.trim();
  if (query) {
    const terms = searchTokens(query, glossary);
    let hits = 0;
    for (const term of terms) {
      if (haystack.includes(term)) {
        hits += 1;
        score += term.length > 8 ? 5 : 2;
      }
    }
    if (hits === 0 && wantedSkins.length === 0) return -1;
  }
  return score;
}

const SEARCH_STOP = new Set([
  "عندكم",
  "عندك",
  "حساب",
  "حسابه",
  "فيه",
  "في",
  "أقل",
  "اقل",
  "من",
  "تبي",
  "أبي",
  "ابي",
  "نبي",
  "بأقل",
  "باقل",
  "هل",
  "شيء",
  "شي",
  "هذا",
  "هذي",
  "اللي",
  "ولا",
  "يعني",
  "وش",
  "ايش",
  "موجود",
  "ميزانية",
  "ريال",
  "تحت",
]);

export function searchTokens(query: string, glossary: GlossaryEntry[]): string[] {
  const tokens = new Set<string>();
  const normalized = normalizeDigits(query).toLowerCase();
  for (const part of normalized.split(/\s+/)) {
    const clean = part.replace(/[؟?!.،,]/g, "");
    if (clean.length >= 3 && !SEARCH_STOP.has(clean) && !/^\d+$/.test(clean)) {
      tokens.add(clean);
    }
  }
  for (const entry of glossary) {
    const keys = [entry.term, ...(entry.aliases ?? [])];
    if (keys.some((key) => key.length >= 2 && normalized.includes(key.toLowerCase()))) {
      for (const key of keys) tokens.add(key.toLowerCase());
    }
  }
  return [...tokens];
}

export function rankListings(
  listings: SearchableListing[],
  filters: ListingSearchFilters,
  glossary: GlossaryEntry[],
): PublicListing[] {
  const limit = filters.limit ?? 3;
  return listings
    .map((listing) => ({ listing, score: scoreListing(listing, filters, glossary) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.listing.price - b.listing.price)
    .slice(0, limit)
    .map((row) => toPublicListing(row.listing));
}

export function formatSearchReply(hits: PublicListing[]): string {
  if (hits.length === 0) {
    return "ما لقيت إعلان منشور يطابق طلبك الحين. تقدر تسجّل طلب وأبلغك أول ما ينزل شيء مناسب.";
  }
  const lines = hits.map((hit, index) => `${index + 1}) ${formatPublicListing(hit)}`);
  return `أنسب المعروض في هالقناة:\n\n${lines.join("\n\n")}\n\nالتسليم والشراء عبر المالك فقط. إذا تبي أسأل عن واحد، قل رقمه مثل A001.`;
}
