import { detectInquiryCode } from "../domain/inquiry-detect";
import { answerGlossaryQuestion, type GlossaryEntry } from "../domain/glossary";
import { parsePrice } from "../domain/price";
import { extractListedPrice } from "../domain/extract";
import { CLARIFY_QUESTION, OWNER_CLARIFY_QUESTION } from "./tools";
import { parseSearchFilters, type ListingSearchFilters } from "./search";
import { isStoreAdmin, type AgentRole } from "./roles";

export interface HeuristicContext {
  glossary: GlossaryEntry[];
  focusShortCode: string | null;
  role?: AgentRole;
  hasDraft?: boolean;
  hasVideo?: boolean;
  hasPhoto?: boolean;
  hasVoice?: boolean;
  lastSearchCodes?: string[];
}

export type HeuristicPlan =
  | { kind: "glossary"; answer: string }
  | { kind: "search"; filters: ListingSearchFilters }
  | { kind: "get"; shortCode?: string; index?: number }
  | { kind: "inquire"; shortCode: string }
  | { kind: "save_request"; budgetMax?: number; skins: string[]; binding?: string; notes: string }
  | { kind: "start_listing"; description?: string; price?: number; binding?: string }
  | { kind: "update_draft"; description?: string; price?: number; binding?: string }
  | { kind: "publish" }
  | { kind: "mark_sold"; shortCode?: string }
  | { kind: "delete_listing"; shortCode?: string }
  | { kind: "seller_reply"; available?: boolean; price?: number }
  | { kind: "store_settings"; patch: Record<string, unknown> }
  | { kind: "subscription" }
  | { kind: "receipt"; receiptKind?: string }
  | { kind: "list_listings" }
  | { kind: "list_inquiries" }
  | { kind: "store_stats" }
  | { kind: "list_stores" }
  | { kind: "owner_help"; topic?: string }
  | { kind: "clarify"; question: string; reason: string };

const SEARCH_HINT =
  /(عندكم|عندك|فيه حساب|في حساب|تبي حساب|أبحث|ابحث|دورون|تدور|أقل من|اقل من|بأقل|باقل|ميزانية|نبي حساب|أبي حساب زين|ابغى حساب|يبغى حساب|هل عندكم|وروني|ورني|شو عندكم|وش عندكم|ابي اشتري|أبي أشتري|ابغى اشتري|أبغى أشتري|ابغي اشتري|ودي اشتري|ودي حساب|ابغي حساب|وش متوفر|ايش متوفر|شنو عندكم|تبيعون|عندكم شي|how much|do you have|account under)/i;
const SAVE_HINT =
  /(بلغني|نبّهني|نبهني|سجّل طلب|سجل طلب|أول ما ينزل|اول ما ينزل|إذا نزل|اذا نزل|خلني أعرف|خبرني إذا|خبرني اذا)/i;
const LAST_PRICE =
  /(آخر سعر|اخر سعر|كم السعر|كم سعره|كم سعرها|وكم|تفاوض|كم آخره|كم اخره|آخره|اخره|بكم|سعره كم|سعرها كم|كم تبي فيه|كم تبغى فيه|how much|last price)/i;
const AVAIL =
  /(موجود|ما انباع|باقي|تحقق|ولا انباع|أو انباع|او انباع|انباع\s*[؟?]|تم البيع\s*[؟?]|الا فيه|هل انباع|هل موجود|لساته موجود|لسه موجود|ما زال موجود|مازال موجود)/i;
const THIS_LISTING = /(هالإعلان|هالاعلان|هذا|هالواحد|اللي تكلمنا|مربوط|مفكوك|الوصف|تفاصيل)/i;
const START_LISTING =
  /(أبي أبيع|ابي ابيع|أبغى أبيع|ابغى ابيع|عندي حساب|أبيع|ابيع|سوي إعلان|سوي اعلان|أبي أنشر|ابي انشر|انزل حساب|أبي أعلن|ابي اعلن|أعلن حساب|ودي ابيع|ودي أبيع|بغيت ابيع|بغيت أبيع|ابغي ابيع|ابي انزل اعلان|أبي أنزل إعلان|ابغى انزل|أبغى أنزل|أبي أعرض|ابي اعرض|أبغى أعرض|ابغى اعرض|أعرض حساب|اعرض حساب|أبي أنزل|ابي انزل|أبغى أنزل إعلان|انزل إعلان|انزل اعلان|أبي أنزل إعلان|ودي أعرض|ودي اعرض|بغيت أعرض|بغيت اعرض|أفتح إعلان|افتح اعلان|نزل إعلان|نزل اعلان|انا بائع|أنا بائع|انا بايع|أنا بايع|بائع عندكم|بايع عندكم|يعلن عندك|بعلن عندك|بعلن عندكم|بنشر عندك|يعلن عندكم|اعلن عندك|أعلن عندك|اعلن عندكم|أعلن عندكم|ابي اعلن|أبي أعلن|ابغى اعلن|أبغى أعلن|ابي انشر اعلان|أبي أنشر إعلان|ابي احط اعلان|أبي أحط إعلان)/i;

/** تصفح / سؤال فقط — مو شراء ولا بيع */
const BROWSE_ONLY =
  /(بس اشوف|بس أشوف|أبغى أشوف|ابغى اشوف|ابي اشوف|أبي أشوف|اشوف بس|أشوف بس|أتصفح|اتصفح|نتصفح|تصفح|سؤال فقط|بس أسأل|بس اسال|أبي أسأل|ابي اسال|ودي أفهم|ودي افهم|وش الإعلان|وش الاعلان|تفاصيل الإعلان|تفاصيل الاعلان)/i;

/** تحويل/لصق إعلان موجود للتحقق — مو نشر */
const FORWARDED_LOOKUP =
  /(حوّلت إعلان|حولت اعلان|حوّلت رسالة|حولت رسالة|نص الإعلان|نص الاعلان|أقدر أرسلك الوصف|اقدر ارسلك الوصف|أرسله وأشوف|ارسلك الوصف|شيك على الإعلان|شيك على الاعلان)/i;

/** هل الرسالة نية بيع/عرض حساب (حتى لو الدور مشتري) */
export function looksLikeSellIntent(text: string): boolean {
  return START_LISTING.test(text);
}

const SELLER_DESC_HINT =
  /(لفل|مثك|ميثك|المختبر|مختبر|سقوط|امفور|ايكي|تيشيرت|تيشرت|فيس|الربط|ربط|بريد|سكن|مثالي|كيل\s*مسج|ماكس|السعر|القيمه|القيمة)/gi;
/** وصف حساب من بائع (لفل/سكنات/الربط/السعر…) — مو سؤال توفر حتى لو فيه «الباقي/موجود» */
export function looksLikeSellerDescription(text: string): boolean {
  const t = text.trim();
  if (t.length < 40) return false;
  if (/[؟?]/.test(t) && t.length < 80) return false;
  const hits = new Set((t.match(SELLER_DESC_HINT) ?? []).map((h) => h.toLowerCase()));
  return hits.size >= 3;
}

/** سؤال توفر/انباع من مشتري — أبدًا مو mark_sold ولا مسودة */
export function looksLikeAvailabilityAsk(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (looksLikeSellerDescription(t)) return false;
  if (looksLikeSellIntent(t) && !AVAIL.test(t)) return false;
  // «متوفر تابي/تمارا/أقساط» داخل وصف الإعلان ≠ سؤال توفر
  const cleaned = t.replace(/متوفر\s*(?:تابي|تمارا|أقساط|اقساط)[^\n]*/gi, " ");
  if (/موجود\s*(ولا|أو|او)?\s*انباع/i.test(cleaned)) return true;
  if (/^(موجود|تحقق|فيه)[.!؟?\s]*$/i.test(cleaned)) return true;
  // «انباع؟» سؤال مشتري — «انباع» لوحدها من بائع = تأكيد بيع
  if (/^انباع\s*[؟?]\s*$/i.test(cleaned)) return true;
  if (AVAIL.test(cleaned) && !/(انشره|انشرها|انشر|نزّله|نزله)/i.test(cleaned)) return true;
  if (FORWARDED_LOOKUP.test(t)) return true;
  return false;
}

/** وصف يلصق/يُحوَّل من إعلان متجر موجود (سعر + سكنات + @ أو تابي) */
export function looksLikeExistingStoreAd(text: string): boolean {
  const t = text.trim();
  if (t.length < 35) return false;
  if (looksLikeSellIntent(t)) return false;
  const hasPrice =
    /(القيمة|القيمه|السعر|سعر)\s*[:：=\-]?\s*\d{2,5}/i.test(t) ||
    /(?:^|\n)\s*\d{2,5}\s*(?:ريال)?\s*$/m.test(t);
  const hasInstallment = /(تابي|تمارا|أقساط|اقساط|متوفر\s*أقساط)/i.test(t);
  const hasAt = /@\w{3,}/.test(t);
  const hasSkins = /(سقوط|جاكيت|سترة|فيس|اطار|إطار|ماسك|لثمة|كاب|شورت|لفل|كونكر|مثالي|بدلة)/i.test(t);
  const hasBinding = /(الربط|ايميل|إيميل|جوجل|تغير ايميل|متاح التغيير)/i.test(t);
  const score = [hasPrice, hasInstallment, hasAt, hasSkins, hasBinding].filter(Boolean).length;
  return score >= 3;
}

/** مشتري يتحقق من إعلان (نص/ميديا) — ممنوع start_listing */
export function looksLikeBuyerListingLookup(text: string): boolean {
  if (looksLikeSellIntent(text) || /(انشره|انشرها|انشر|نزّله|نزله|أبي أنزل|ابي انزل)/i.test(text)) return false;
  return (
    looksLikeAvailabilityAsk(text) ||
    looksLikeExistingStoreAd(text) ||
    FORWARDED_LOOKUP.test(text)
  );
}
const OWNER_ROLE =
  /(انا المالك|أنا المالك|لست مشتري|لست بايع|لست بائع|مو مشتري|مو بايع|مو بائع|ما انا مشتري|ما أنا مشتري|ما انا بايع|ما أنا بايع|كيف يبدأ الإعلان|كيف يبدا الاعلان|كيف ابدأ الإعلان|كيف ابدا الاعلان|كيف يبدأ الاعلان وأنا|كيف يبدا الاعلان وانا|دور المالك|أنا صاحب المتجر|انا صاحب المتجر)/i;
const SHORT_ACK =
  /^(ممتاز|تمام|طيب|زين|اوك|أوك|ok|okay|شكرا|شكراً|thanks)[.!؟\s]*$/i;
const LOOKS_LIKE_AD =
  /(^|[\s\-])(اعلان|إعلان)\b|السقوط|سقوط\s*[AB]|كونكر|مثالي|فيس\s*ك|بريد|جوجل|ربط\s*إيميل|رقم\s*الجوال|@\w+/i;
const PUBLISH = /(انشره|انشرها|انشر|نزّله|نزله|نزّلها|نزلها|نشره|أعلنه|اعلنه)/i;
const SOLD = /(انباع|تم البيع|بيعته|بعته|sold|صار مباع)/i;
/** تأكيد بيع من البائع فقط — مو سؤال «موجود ولا انباع» */
function looksLikeMarkSoldCommand(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/[؟?]/.test(t)) return false;
  if (looksLikeAvailabilityAsk(t)) return false;
  if (/موجود|ولا|تحقق|هل\b/i.test(t) && /انباع|بيع/i.test(t)) return false;
  return /^(تم البيع|انباع|بيعته|بعته|sold|صار مباع)\s*$/i.test(t) ||
    /(علّمه مباع|علمه مباع|خلّه مباع|خله مباع|علّم الإعلان مباع|علم الاعلان مباع)/i.test(t);
}

const DELETE = /(احذفه|احذفها|شله|شيله|امسحه|delete)/i;
const RECEIPT = /(إيصال|ايصال|تحويل|ستريب|الإيصال|الايصال|receipt)/i;
const SUB = /(اشتراك|التجربة|تجديد|باقة|subscription)/i;
const SETTINGS = /(إعدادات|اعدادات|غيّر الرسوم|غير الرسوم|تعليمات الدفع|معجم)/i;
const OWNER_LISTINGS = /(كم إعلان|كم اعلان|عدد الإعلان|عدد الاعلان|إعلاناتي|اعلاناتي|إعلان عندي|اعلان عندي|إعلانات المتجر|اعلانات المتجر)/i;
const OWNER_INQUIRIES = /(استفسار|الاستفسارات|آخر الاستفسار|اخر الاستفسار)/i;
const OWNER_STATS = /(إحصائ|احصائ|إحصاء|احصاء)/i;
const OWNER_ADD_CHANNEL = /(قناة ثانية|قناه ثانية|متجر ثاني|بوت ثاني|أضيف قناة|اضيف قناة|أضيف متجر|اضيف متجر|اربط قناة|أربط قناة|اربط القناة|أربط القناة|ربط القناة|ربط قناة|اربط المجموعة|أربط المجموعة|غيّر القناة|غير القناة|ربط المجموعة)/i;
const OWNER_UNBIND = /(فك الربط|فك ربط|ألغ الربط|الغاء الربط|أفك الربط|افك الربط)/i;
const OWNER_DELETE_LAST = /(احذف آخر|احذف الاخر|احذف الأخير|احذف الاخير|شيل آخر إعلان|شيل اخر اعلان)/i;
const OWNER_FEE = /(الرسوم|رسوم الإعلان|رسوم الاعلان)/i;
const OWNER_STORES = /(المتاجر|كم بوت|قائمة البوت|قائمه البوت)/i;
const SELLER_OK = /(متوفر|موجود عندي|تمام موجود|أبي أرد|ابي ارد)/i;
const ORDINAL_SECOND = /(الثاني|ثاني واحد|لا الثاني|مو هذا الثاني)/i;
const ORDINAL_FIRST = /(الأول|الاول|هذا الأول|هذا الاول)/i;
const ORDINAL_THIRD = /(الثالث)/i;

function listingPrice(text: string): number | null {
  return extractListedPrice(text) ?? (text.trim().length < 40 ? parsePrice(text) : null);
}

export function looksLikeOwnerAdmin(text: string): boolean {
  return (
    OWNER_LISTINGS.test(text) ||
    OWNER_INQUIRIES.test(text) ||
    OWNER_STATS.test(text) ||
    OWNER_ADD_CHANNEL.test(text) ||
    OWNER_UNBIND.test(text) ||
    OWNER_DELETE_LAST.test(text) ||
    OWNER_FEE.test(text) ||
    SETTINGS.test(text) ||
    SUB.test(text) ||
    OWNER_STORES.test(text) ||
    OWNER_ROLE.test(text)
  );
}

function buyerLookupPlan(text: string, ctx: HeuristicContext): HeuristicPlan {
  const code = detectInquiryCode(text);
  if (code) return { kind: "inquire", shortCode: code };
  if (ctx.focusShortCode) return { kind: "inquire", shortCode: ctx.focusShortCode };
  const filters = parseSearchFilters(text, ctx.glossary);
  const price = listingPrice(text);
  if (price != null) {
    filters.minPrice = Math.max(1, Math.floor(price * 0.9));
    filters.maxPrice = Math.ceil(price * 1.1);
  }
  if (/سقوط/i.test(text)) {
    const skins = new Set(filters.skins ?? []);
    skins.add("سترة السقوط");
    filters.skins = [...skins];
  }
  return { kind: "search", filters: { ...filters, query: filters.query || text, limit: 3 } };
}

export function planHeuristic(text: string, ctx: HeuristicContext): HeuristicPlan {
  const role = ctx.role ?? "buyer";
  const sellerish = role === "seller" || isStoreAdmin(role);
  const admin = isStoreAdmin(role);
  const clearSell = looksLikeSellIntent(text);
  // تحقق التوفر / تحويل دائماً lookup. لصق إعلان موجود من مشتري = lookup؛ من بائع معروف = نشر.
  const buyerLookup =
    looksLikeAvailabilityAsk(text) ||
    FORWARDED_LOOKUP.test(text) ||
    (looksLikeExistingStoreAd(text) && !sellerish);
  // ميديا وحدها ما تفتح مسودة للمشتري. المسودة: نية بيع صريحة أو بائع يرسل ميديا بدون سؤال توفر.
  const listingActor =
    !buyerLookup &&
    (clearSell || (sellerish && (Boolean(ctx.hasVideo) || (Boolean(ctx.hasPhoto) && !RECEIPT.test(text)))));

  // بائع عنده مسودة ويرسل وصف الحساب → حدّث المسودة (وصف + سعر)، أبدًا lookup
  if (sellerish && ctx.hasDraft && !ctx.hasVideo && !ctx.hasPhoto && looksLikeSellerDescription(text)) {
    return { kind: "update_draft", description: text.trim(), price: listingPrice(text) ?? undefined };
  }

  if (admin) {
    const adminPlan = planOwnerAdmin(text, role);
    if (adminPlan) return adminPlan;
  }

  // حارس صارم: تحقق توفر / لصق أو تحويل إعلان موجود → بحث أو استفسار، أبدًا start_listing
  if (buyerLookup) {
    return buyerLookupPlan(text, ctx);
  }

  if (ctx.hasPhoto && RECEIPT.test(text)) {
    return { kind: "receipt", receiptKind: isStoreAdmin(role) ? "subscription" : "listing" };
  }
  if (ctx.hasPhoto && !text.trim() && listingActor) {
    return { kind: "start_listing" };
  }
  if (
    listingActor &&
    ctx.hasPhoto &&
    (/(حساب|لفل|سكن|مثالي|سعر|اعلان|إعلان|سقوط|كونكر)/i.test(text) || LOOKS_LIKE_AD.test(text)) &&
    !RECEIPT.test(text)
  ) {
    const price = listingPrice(text);
    return { kind: "start_listing", description: text, price: price ?? undefined };
  }
  if (ctx.hasVideo && listingActor) {
    const price = listingPrice(text);
    return { kind: "start_listing", description: text.trim() || undefined, price: price ?? undefined };
  }
  // وصف إعلان طويل واضح + بائع بنية بيع صريحة / بائع معروف — بدون سياق تحقق مشتري
  if (
    listingActor &&
    !RECEIPT.test(text) &&
    text.length >= 40 &&
    LOOKS_LIKE_AD.test(text) &&
    (/(سعر|ريال|\d{2,5})/i.test(text) || parsePrice(text) !== null)
  ) {
    const price = listingPrice(text);
    return { kind: "start_listing", description: text, price: price ?? undefined };
  }

  const glossary = answerGlossaryQuestion(text, ctx.glossary);
  if (glossary && !SEARCH_HINT.test(text) && !/(أقل من|اقل من|تحت|بأقل|باقل)/i.test(text)) {
    return { kind: "glossary", answer: glossary };
  }

  if (sellerish && SETTINGS.test(text) && admin) {
    const fee = parsePrice(text);
    return { kind: "store_settings", patch: fee != null ? { listingFee: fee } : {} };
  }
  if (sellerish && SUB.test(text) && admin) {
    return { kind: "subscription" };
  }
  if (sellerish && RECEIPT.test(text)) {
    return { kind: "receipt" };
  }

  const codes = ctx.lastSearchCodes ?? [];
  if (ORDINAL_SECOND.test(text) && codes[1]) {
    return LAST_PRICE.test(text) || AVAIL.test(text)
      ? { kind: "inquire", shortCode: codes[1] }
      : { kind: "get", shortCode: codes[1], index: 2 };
  }
  if (ORDINAL_THIRD.test(text) && codes[2]) {
    return { kind: "get", shortCode: codes[2], index: 3 };
  }
  if (ORDINAL_FIRST.test(text) && codes[0]) {
    return LAST_PRICE.test(text) || AVAIL.test(text)
      ? { kind: "inquire", shortCode: codes[0] }
      : { kind: "get", shortCode: codes[0], index: 1 };
  }

  const code = detectInquiryCode(text);
  if (code && /(ورني|وروني|تفاصيل|وصف الإعلان|وصف الاعلان)/i.test(text)) {
    return { kind: "get", shortCode: code };
  }

  if (sellerish && looksLikeMarkSoldCommand(text)) {
    return { kind: "mark_sold", shortCode: code ?? ctx.focusShortCode ?? undefined };
  }
  if (sellerish && DELETE.test(text)) {
    return { kind: "delete_listing", shortCode: code ?? ctx.focusShortCode ?? undefined };
  }
  if (sellerish && PUBLISH.test(text) && (ctx.hasDraft || ctx.hasVideo)) {
    return { kind: "publish" };
  }
  if (listingActor && START_LISTING.test(text)) {
    const price = listingPrice(text);
    return { kind: "start_listing", description: text, price: price ?? undefined };
  }
  if (sellerish && ctx.hasDraft && !admin && parsePrice(text) !== null && text.length < 40) {
    return { kind: "update_draft", price: parsePrice(text) ?? undefined, description: undefined };
  }
  if (sellerish && ctx.hasDraft && admin && parsePrice(text) !== null && text.length < 40 && !looksLikeOwnerAdmin(text) && !SEARCH_HINT.test(text)) {
    return { kind: "update_draft", price: parsePrice(text) ?? undefined, description: undefined };
  }
  if (sellerish && SELLER_OK.test(text)) {
    return { kind: "seller_reply", available: true, price: parsePrice(text) ?? undefined };
  }
  // رقم سعر لوحده من البائع → رد على استفسار انتظار (مو تحديث مسودة)
  if (
    sellerish &&
    !ctx.hasDraft &&
    parsePrice(text) !== null &&
    text.trim().length < 24 &&
    /^\d{2,6}(?:\s*(?:ريال|ر\.?س|sar))?$/i.test(text.trim().replace(/[.,]/g, ""))
  ) {
    return { kind: "seller_reply", available: true, price: parsePrice(text) ?? undefined };
  }

  if (code && (AVAIL.test(text) || LAST_PRICE.test(text) || looksLikeBareCode(text, code))) {
    return { kind: "inquire", shortCode: code };
  }

  if (SAVE_HINT.test(text)) {
    const filters = parseSearchFilters(text, ctx.glossary);
    return {
      kind: "save_request",
      budgetMax: filters.maxPrice,
      skins: filters.skins ?? [],
      binding: filters.binding,
      notes: text,
    };
  }

  if ((LAST_PRICE.test(text) || AVAIL.test(text)) && ctx.focusShortCode && !code) {
    return { kind: "inquire", shortCode: ctx.focusShortCode };
  }

  const filters = parseSearchFilters(text, ctx.glossary);
  const hasSearchBits = Boolean(
    filters.maxPrice || filters.minPrice || (filters.skins && filters.skins.length > 0) || filters.binding,
  );
  if (SEARCH_HINT.test(text) || (hasSearchBits && /(حساب|سكن|مثالي|بدلة|ربط|كونكر|ثلج)/i.test(text))) {
    return { kind: "search", filters: { ...filters, query: filters.query || text } };
  }

  if (ctx.focusShortCode && (THIS_LISTING.test(text) || BROWSE_ONLY.test(text))) {
    return { kind: "get", shortCode: ctx.focusShortCode };
  }

  if (BROWSE_ONLY.test(text) && ctx.focusShortCode) {
    return { kind: "get", shortCode: ctx.focusShortCode };
  }

  if (ctx.hasVoice && !text.trim()) {
    return { kind: "clarify", question: "ما سمعت الصوت كويس، تكتب لي وش تبي؟", reason: "voice_empty" };
  }

  return {
    kind: "clarify",
    question: admin ? OWNER_CLARIFY_QUESTION : CLARIFY_QUESTION,
    reason: "unclear",
  };
}

function planOwnerAdmin(text: string, role: AgentRole): HeuristicPlan | null {
  if (OWNER_ROLE.test(text)) return { kind: "owner_help", topic: "owner_role" };
  if (SHORT_ACK.test(text.trim())) {
    return { kind: "clarify", question: "تمام، متى ما تبي شي قولي.", reason: "short_ack" };
  }
  if (OWNER_UNBIND.test(text)) return { kind: "owner_help", topic: "unbind_channel" };
  if (OWNER_ADD_CHANNEL.test(text)) return { kind: "owner_help", topic: "bind_channel" };
  if (OWNER_DELETE_LAST.test(text)) return { kind: "delete_listing" };
  if (OWNER_LISTINGS.test(text)) return { kind: "list_listings" };
  if (OWNER_INQUIRIES.test(text)) return { kind: "list_inquiries" };
  if (OWNER_STATS.test(text)) return { kind: "store_stats" };
  if (OWNER_STORES.test(text) && role === "super_admin") return { kind: "list_stores" };
  if (OWNER_FEE.test(text) || /غيّر الرسوم|غير الرسوم/.test(text)) {
    const fee = parsePrice(text);
    return { kind: "store_settings", patch: fee != null ? { listingFee: fee } : {} };
  }
  return null;
}

function looksLikeBareCode(text: string, code: string): boolean {
  const trimmed = text.replace(/[؟?!.،,]/g, "").trim();
  return trimmed.toUpperCase() === code.toUpperCase();
}

/** نية بيع مجردة بدون وصف/سعر — نرد بطلب الميديا والوصف والسعر مباشرة */
export function isBareSellIntent(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 40 || /\d/.test(t)) return false;
  if (looksLikeAvailabilityAsk(t)) return false;
  return looksLikeSellIntent(t);
}

const PLACEHOLDER_WORDS =
  /(فيديو|فديو|الفيديو|الفديو|صورة|صوره|صور|صوت|مقطع|حساب\s*ببجي|حساب|متوفر\s*(?:أقساط|اقساط|تابي|تمارا)[^\n]*|أقساط|اقساط|دفعة|دفعه|السعر|سعر|ريال|قابل\s*للتفاوض|@\w+|[\d\s.,:()\-+،؛!؟?#*_|/\\]+)/gi;

/** وصف حقيقي للحساب (مو «فيديو» ولا سطر أقساط/يوزر) */
export function hasRealDescription(text: string | null | undefined): boolean {
  if (text && text.trim().length < 40 && (looksLikeSellIntent(text) || PUBLISH.test(text))) return false;
  const t = (text ?? "").replace(PLACEHOLDER_WORDS, " ").replace(/\s+/g, " ").trim();
  return t.replace(/\s/g, "").length >= 12;
}

/** يرجّع الوصف إذا حقيقي، وإلا undefined (عشان ما يمسح وصف سابق) */
export function realDescriptionOrUndefined(text: string | null | undefined): string | undefined {
  return hasRealDescription(text) ? String(text).trim() : undefined;
}
