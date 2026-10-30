import type { ExtractedFields } from "../domain/extract";
import { formatPrice } from "../domain/price";
import type { CoverTheme } from "./theme";

export interface CoverCard {
  title: string;
  shortCode: string;
  priceLabel: string;
  level?: string;
  skins: string;
}

export function buildCoverCard(input: {
  shortCode: string;
  price: number;
  extracted: ExtractedFields;
  theme: CoverTheme;
}): CoverCard {
  const skins = (input.extracted.skins ?? []).filter(Boolean).slice(0, 3).join(" · ");
  return {
    title: input.theme.title,
    shortCode: input.shortCode,
    priceLabel: `${formatPrice(input.price)} ريال`,
    level: input.extracted.level ? `لفل ${input.extracted.level}` : undefined,
    skins,
  };
}
