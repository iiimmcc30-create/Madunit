import { normalizeDigits } from "./digits";
import { parsePrice } from "./price";
import { sanitizeListingText } from "./sanitize";

export interface ExtractedFields {
  level?: number;
  binding?: string;
  skins?: string[];
  upgradedWeapons?: string[];
  country?: string;
  playerId?: string;
}

const BINDING_RE = /(?:ربط|الربط)\s*[:\-–]?\s*(جوجل|google|فيس(?:بوك)?|facebook|تويتر|twitter|ضيف|guest|آبل|ابل|apple)/i;
const COUNTRY_RE =
  /(السعودية|سعودي|الكويت|كويتي|الإمارات|اماراتي|قطر|قطري|البحرين|بحريني|عمان|عماني|مصر|مصري|الأردن|اردني|العراق|عراقي)/i;

export function extractFields(description: string, binding = ""): ExtractedFields {
  const text = normalizeDigits(description);
  const levelMatch = text.match(/(?:لفل|lvl|level|lv)\s*[:\-–]?\s*(\d{1,3})/i);
  const playerIdMatch = text.match(/(?:id|آي\s*دي|ايدي)\s*[:\-–]?\s*(\d{5,20})/i);
  const bindingMatch = text.match(BINDING_RE);
  const countryMatch = text.match(COUNTRY_RE);

  const fields: ExtractedFields = {
    binding: binding.trim() || bindingMatch?.[1] || undefined,
  };

  if (levelMatch) fields.level = Number(levelMatch[1]);
  if (playerIdMatch) fields.playerId = playerIdMatch[1];
  if (countryMatch) fields.country = countryMatch[1];

  return fields;
}

export function extractListedPrice(text: string): number | null {
  const normalized = normalizeDigits(text);
  const nearRiyal = [...normalized.matchAll(/(\d+(?:\.\d+)?)\s*(?:ريال|ر\.س|﷼)/gi)];
  if (nearRiyal.length) return parsePrice(nearRiyal[nearRiyal.length - 1][0]);
  const nearLabel = [
    ...normalized.matchAll(/(?:سعر|القيمة|القيمه|قيمة|قيمه)\s*[:\-–=]?\s*(\d+(?:\.\d+)?)/gi),
  ];
  if (nearLabel.length) return parsePrice(nearLabel[nearLabel.length - 1][1]);
  // رقم وحيد قصير (مثل «1000») — مو أرقام السكنات داخل وصف طويل
  if (normalized.trim().length < 40) return parsePrice(normalized);
  return null;
}


export function mergeExtractedFields(
  base: ExtractedFields,
  extra?: ExtractedFields | null,
): ExtractedFields {
  if (!extra) return base;
  return {
    level: extra.level ?? base.level,
    binding: extra.binding ?? base.binding,
    skins: extra.skins?.length ? extra.skins : base.skins,
    upgradedWeapons: extra.upgradedWeapons?.length ? extra.upgradedWeapons : base.upgradedWeapons,
    country: extra.country ?? base.country,
    playerId: extra.playerId ?? base.playerId,
  };
}

export function composeListingDescription(fields: ExtractedFields, original: string): string {
  const lines: string[] = [];
  if (fields.level) lines.push(`لفل ${fields.level}`);
  if (fields.skins?.length) lines.push(`السكنات: ${fields.skins.join("، ")}`);
  if (fields.upgradedWeapons?.length) {
    lines.push(`أسلحة مطوّرة: ${fields.upgradedWeapons.join("، ")}`);
  }
  if (fields.country) lines.push(`البلد: ${fields.country}`);
  const body = sanitizeListingText(original);
  if (lines.length === 0) return body;
  if (!body) return lines.join("\n");
  return `${lines.join("\n")}\n\n${body}`;
}

export type MissingListingField = "description" | "price" | "binding";

export function missingListingFields(input: {
  description: string;
  price: number | null;
  binding: string;
}): MissingListingField[] {
  const missing: MissingListingField[] = [];
  if (sanitizeListingText(input.description).length < 3) missing.push("description");
  if (input.price === null) missing.push("price");
  if (!input.binding.trim()) missing.push("binding");
  return missing;
}

export { fingerprintFromVideo } from "./fingerprint";
