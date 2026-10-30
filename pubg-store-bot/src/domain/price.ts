import { normalizeDigits } from "./digits";

export function parsePrice(input: string): number | null {
  const normalized = normalizeDigits(input).replace(/,/g, "").replace(/٫/g, ".");
  if (/[-−]\s*\d/.test(normalized)) return null;
  const match = normalized.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value > 1_000_000) return null;
  return value;
}

export function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
