/**
 * Free-text (Gulf Arabic) management intents for the platform/main bot.
 * Pure and dependency-free so it can be unit tested; the LLM is only a fallback.
 */
export type AdminIntentKind =
  | "add_bot"
  | "list_stores"
  | "status"
  | "stats"
  | "disable_store"
  | "enable_store"
  | "delete_store"
  | "unbind_channel"
  | "bind_channel"
  | "subscriptions"
  | "extend"
  | "scrim_link"
  | "create_ad"
  | "help"
  | "unknown";

export interface AdminIntent {
  kind: AdminIntentKind;
  /** @username or name of the store the user mentioned, if any. */
  target?: string;
}

export const ADMIN_INTENT_KINDS: AdminIntentKind[] = [
  "add_bot",
  "list_stores",
  "status",
  "stats",
  "disable_store",
  "enable_store",
  "delete_store",
  "unbind_channel",
  "bind_channel",
  "subscriptions",
  "extend",
  "scrim_link",
  "create_ad",
  "help",
  "unknown",
];

/** Folds Arabic spelling variants so regexes stay small. */
export function normalizeArabic(text: string): string {
  return text
    .replace(/[\u064B-\u0652\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const BOT = "(بوت|بوتات|البوت|البوتات|متجر|متاجر|المتجر|المتاجر|ستور|store|bot)";
const ADD = "(ضيف|اضيف|اضف|ضف|نضيف|زيد|ركب|اربط|نربط|ابي اربط|ابغي اربط|جديد|add)";

const RULES: Array<[AdminIntentKind, RegExp]> = [
  ["help", /^(مساعده|help|الاوامر|وش تسوي|وش اقدر اسوي|ايش تسوي|القائمه|المنيو|menu|ابدا|start)\s*[؟?]?$/],
  ["create_ad", /(اعلان|اعلن|انشر حساب|ابيع|بيع حساب|انزل حساب|عرض حساب|عندي حساب|نشر حساب|ارفع فيديو|فيديو الحساب)/],
  ["scrim_link", /(سكرم|سكريم|scrim)/],
  ["unbind_channel", /(فك|فكك|افصل|شيل|الغ|الغي|حذف|احذف|امسح).{0,12}(ربط|قناه|القناه|channel)|(ربط القناه|القناه).{0,8}(فك|الغ|شيل)/],
  ["bind_channel", /(اربط|ربط|ضيف|اضيف).{0,12}(قناه|القناه|channel)/],
  ["delete_store", new RegExp(`(احذف|حذف|امسح|شيل|ازل).{0,10}${BOT}`)],
  ["disable_store", new RegExp(`(وقف|اوقف|ايقاف|طفي|عطل|تعطيل|سكر|اقفل|disable).{0,10}${BOT}|${BOT}.{0,10}(وقف|اوقف|طفي|عطل)`)],
  ["enable_store", new RegExp(`(شغل|فعل|تفعيل|رجع|enable).{0,10}${BOT}|${BOT}.{0,10}(شغل|فعل)`)],
  ["extend", /(مدد|تمديد|مد|زود).{0,15}(اشتراك|يوم|ايام|شهر)|(جدد|تجديد).{0,10}(اشتراك|متجر)/],
  ["subscriptions", /(ايصال|ايصالات|اشتراك|اشتراكات|دفعات|تحويلات|receipt|subscription)/],
  ["add_bot", new RegExp(`${ADD}.{0,15}${BOT}|${BOT}.{0,6}جديد|توكن|token`)],
  ["status", new RegExp(`(حاله|وضع|شغاله|شغال|تشتغل|واقف|status).{0,12}${BOT}|${BOT}.{0,12}(شغاله|شغال|واقفه|حالتها|وضعها)`)],
  ["stats", /(احصاي|احصا|ارقام|دخل|ارباح|stats)/],
  ["list_stores", new RegExp(`(كم|عدد|قايمه|لسته|ورني|وريني|اعرض|عرض|كل|list).{0,10}${BOT}|^${BOT}$|${BOT}.{0,6}(عندي|حقي|حقتي)`)],
];

export function extractStoreTarget(text: string): string | undefined {
  const at = text.match(/@([A-Za-z0-9_]{3,})/);
  if (at) return at[1];
  const latin = text.match(/\b([A-Za-z][A-Za-z0-9_]{3,}(?:_?bot))\b/i);
  if (latin) return latin[1];
  const named = normalizeArabic(text).match(/(?:متجر|بوت|المتجر|البوت)\s+([^\s؟?]{2,})/);
  if (named && !/^(جديد|ثاني|حقي|عندي|كلها|الكل)$/.test(named[1])) return named[1];
  return undefined;
}

export function classifyAdminIntent(text: string): AdminIntent {
  const value = normalizeArabic(text);
  if (!value) return { kind: "unknown" };
  for (const [kind, re] of RULES) {
    if (re.test(value)) {
      const target = extractStoreTarget(text);
      return target ? { kind, target } : { kind };
    }
  }
  return { kind: "unknown" };
}

/** Parses an LLM JSON answer; anything malformed becomes unknown. */
export function parseAdminIntentJson(raw: string | null | undefined): AdminIntent {
  if (!raw) return { kind: "unknown" };
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return { kind: "unknown" };
  try {
    const parsed = JSON.parse(match[0]) as { kind?: unknown; target?: unknown };
    const kind = ADMIN_INTENT_KINDS.find((k) => k === parsed.kind) ?? "unknown";
    const target =
      typeof parsed.target === "string" && parsed.target.trim()
        ? parsed.target.trim().replace(/^@/, "")
        : undefined;
    return target ? { kind, target } : { kind };
  } catch {
    return { kind: "unknown" };
  }
}

export const ADMIN_INTENT_SYSTEM_PROMPT = `أنت مصنف أوامر لبوت إدارة منصة متاجر تلغرام. المستخدم مالك المنصة ويكتب باللهجة الخليجية.
صنّف رسالته إلى واحد من: ${ADMIN_INTENT_KINDS.join(", ")}.
add_bot=إضافة/ربط بوت متجر جديد بالتوكن، list_stores=عرض المتاجر أو عددها، status=حالة البوتات، stats=إحصائيات/دخل،
disable_store=إيقاف متجر، enable_store=تفعيل متجر، delete_store=حذف بوت متجر، unbind_channel=فك ربط قناة متجر،
bind_channel=ربط قناة، subscriptions=إيصالات/اشتراكات، extend=تمديد اشتراك، scrim_link=ربط بوت سكرمات،
create_ad=يبي ينشر إعلان/يبيع حساب، help=يسأل وش تقدر تسوي، unknown=غير ذلك.
رد بـ JSON فقط: {"kind":"...","target":"اسم أو يوزر المتجر إن ذُكر"}`;
