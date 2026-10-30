import { normalizeDigits } from "./digits";
import { parsePrice } from "./price";

export function requiresListingReceipt(fee: number): boolean {
  return Number.isFinite(fee) && fee > 0;
}

export function parseListingFee(input: string): number | null {
  const normalized = normalizeDigits(input).replace(/,/g, "").replace(/٫/g, ".").trim();
  if (normalized === "0" || normalized === "0.0" || normalized === "0.00") return 0;
  return parsePrice(input);
}
