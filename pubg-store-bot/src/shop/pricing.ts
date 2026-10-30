/** Pricing helpers (pure, unit-tested). */
export const DEFAULT_USD_TO_SAR = 3.75;

export function roundSar(value: number): number {
  // Retail-friendly: round up to the nearest whole riyal ending in 9 for values >= 20.
  const up = Math.ceil(value);
  if (up < 20) return up;
  const r = Math.ceil((up + 1) / 10) * 10 - 1;
  return r;
}

export function priceFromCost(costUsd: number, markupPercent: number, usdToSar = DEFAULT_USD_TO_SAR, shippingUsd = 0): number {
  const base = (costUsd + shippingUsd) * usdToSar;
  return roundSar(base * (1 + markupPercent / 100));
}

/** CJ price fields are often ranges like "1.90 -- 8.64"; take the lowest number. */
export function parseCjPrice(value: unknown): number {
  if (typeof value === "number") return value;
  const nums = String(value ?? "")
    .split(/[^0-9.]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);
  return nums.length ? Math.min(...nums) : 0;
}

export function slugify(input: string, suffix: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return `${base || "product"}-${suffix.slice(-6).toLowerCase()}`;
}

export function isSaudiPhone(phone: string): boolean {
  const digits = phone.replace(/[\s-]/g, "");
  return /^(\+966|00966|0)?5\d{8}$/.test(digits);
}

export function normalizeSaudiPhone(phone: string): string {
  const digits = phone.replace(/[\s-]/g, "").replace(/^(\+966|00966|0)/, "");
  return `+966${digits}`;
}

export function orderNumber(now = new Date(), rand = Math.random()): string {
  const d = now.toISOString().slice(2, 10).replace(/-/g, "");
  return `MU${d}${Math.floor(rand * 1e5).toString().padStart(5, "0")}`;
}
