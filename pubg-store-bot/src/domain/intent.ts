import { normalizeShortCode } from "./short-code";

export type SellerIntent =
  | "list_account"
  | "availability"
  | "price_negotiate"
  | "sold"
  | "general";

const SOLD = /(انباع|تم البيع|\bsold\b)/i;
const AVAILABILITY = /(موجود|توف[رّ]|available|باقي|ما انباع)/i;
const PRICE = /(تفاوض|رخص|أرخص|غالي|آخر سعر|اخر سعر|تنزل)/i;
const LIST = /(أعرض|اعرض|عندي حساب|أعلن|اعلن|أبي أنزل|ابي انزل|خلنا ننشر)/i;

export function classifyIntent(text: string): SellerIntent {
  const value = text.trim();
  if (!value) return "general";

  if (AVAILABILITY.test(value)) return "availability";
  if (SOLD.test(value)) return "sold";
  if (normalizeShortCode(value) && /[؟?]/.test(value)) return "availability";
  if (normalizeShortCode(value) && value.replace(/[A-Za-z0-9\s]/g, "").length === 0) {
    return "availability";
  }
  if (PRICE.test(value)) return "price_negotiate";
  if (LIST.test(value)) return "list_account";
  if (normalizeShortCode(value)) return "availability";
  return "general";
}
