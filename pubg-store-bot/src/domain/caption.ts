import { unexpectedMentions, sanitizeListingText } from "./sanitize";
import { formatPrice } from "./price";

export const TELEGRAM_CAPTION_LIMIT = 1024;

/** زخارف القالب الافتراضي القديم — تُزال إذا القالب = الافتراضي بالإيموجي فقط */
const DEFAULT_TEMPLATE_EMOJIS = ["💰", "🔗", "🏷", "📞", "⚠️", "⚠"] as const;

export const DEFAULT_LISTING_TEMPLATE = `<b>حساب ببجي</b>

{description}

السعر: {price} ريال
الربط: {binding}
رقم الإعلان: <b>{shortCode}</b>

التواصل للشراء: @{ownerUsername}
التسليم والشراء عبر المالك فقط — لا تتعامل مع أي شخص ثاني`

export interface CaptionVars {
  shortCode: string;
  description: string;
  price: number | string;
  binding: string;
  ownerUsername: string;
  sold?: boolean;
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? "");
}

/** إذا القالب هو الافتراضي القديم بالزخارف فقط، رجّع النسخة بدون إيموجي */
export function normalizeListingTemplate(template: string | null | undefined): string {
  const raw = (template ?? "").replace(/\r\n/g, "\n").trim();
  if (!raw) return DEFAULT_LISTING_TEMPLATE;
  let stripped = raw;
  for (const emoji of DEFAULT_TEMPLATE_EMOJIS) {
    stripped = stripped.split(emoji + " ").join("").split(emoji).join("");
  }
  stripped = stripped.replace(/\n{3,}/g, "\n\n").trim();
  if (stripped === DEFAULT_LISTING_TEMPLATE.trim()) {
    return DEFAULT_LISTING_TEMPLATE;
  }
  return template ?? DEFAULT_LISTING_TEMPLATE;
}

function buildVars(input: CaptionVars): Record<string, string> {
  const owner = input.ownerUsername.replace(/^@/, "");
  const price =
    typeof input.price === "number" ? formatPrice(input.price) : input.price;
  return {
    shortCode: escapeHtml(input.shortCode),
    description: escapeHtml(sanitizeListingText(input.description)),
    price: escapeHtml(price),
    binding: escapeHtml(sanitizeListingText(input.binding) || "غير محدد"),
    ownerUsername: escapeHtml(owner),
  };
}

export function formatListingCaption(
  input: CaptionVars,
  template = DEFAULT_LISTING_TEMPLATE,
): string {
  const rendered = renderTemplate(normalizeListingTemplate(template), buildVars(input));
  const withStatus = input.sold ? `تم البيع ✅\n\n${rendered}` : rendered;
  return fitCaption(withStatus);
}

export function fitCaption(caption: string): string {
  if (caption.length <= TELEGRAM_CAPTION_LIMIT) return caption;
  return `${caption.slice(0, TELEGRAM_CAPTION_LIMIT - 1)}…`;
}

export function assertOwnerOnlyMentions(caption: string, ownerUsername: string): void {
  const extras = unexpectedMentions(caption, ownerUsername);
  if (extras.length > 0) {
    throw new Error(`seller leak in caption: ${extras.join(", ")}`);
  }
}
