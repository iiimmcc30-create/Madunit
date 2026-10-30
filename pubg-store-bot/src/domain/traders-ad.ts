import { escapeHtml, fitCaption } from "./caption";

/** Bots allowed to run traders-group → channel ad mirror. */
export const TRADERS_MIRROR_BOTS = ["dmstor_bot", "sarhstoree_bot", "sultan_sl_bot", "s3dstore_bot"] as const;

/** @deprecated use TRADERS_MIRROR_BOTS / isTradersMirrorBot */
export const TRADERS_MIRROR_BOT = "dmstor_bot";

export function isTradersMirrorBot(botUsername: string | null | undefined): boolean {
  const u = (botUsername ?? "").replace(/^@/, "").toLowerCase();
  return (TRADERS_MIRROR_BOTS as readonly string[]).includes(u);
}

export interface DetectAdInput {
  hasPhoto: boolean;
  hasVideo: boolean;
  /** True when this update is part of a media album (photo/video). */
  hasMediaGroup?: boolean;
  caption: string;
}

/**
 * Traders group is ads-only: mirror any photo/video/album.
 * Prefer non-empty caption; still allow media with empty caption (rare).
 * Text-only / stickers / voice / polls never reach here (handler filters).
 */
export function detectAd(input: DetectAdInput): boolean {
  return Boolean(input.hasPhoto || input.hasVideo || input.hasMediaGroup);
}

/** @deprecated kept for tests/call sites — group is ads-only so media is enough. */
export function isListingLikeCaption(caption: string): boolean {
  return (caption ?? "").trim().length > 0;
}

/**
 * Status markers traders put on ads — strip even with punctuation/dashes:
 * «مكرر.» «-جديد-» «مكرر،» not only bare «مكرر» / «جديد».
 */
const STATUS_TOKEN =
  /(?<![A-Za-z\u0600-\u06FF])(?:جديد|مكرر|جديدة|مكررة|جديده|مكرره|NEW|new|duplicate)(?![A-Za-z\u0600-\u06FF])/gi;
const HASHTAG = /#[\w\u0600-\u06FF]+/g;
/** @handles; allow common decoration / zero-width chars between @ and name */
const USERNAME = /(?:@|＠)[\u200B-\u200D\uFEFF\u0640]*[A-Za-z0-9_]{4,32}/g;
const TELEGRAM_LINK = /(?:https?:\/\/)?(?:t(?:elegram)?\.me|telegram\.dog)\/[^\s]+/gi;
const WA_LINK = /(?:https?:\/\/)?(?:wa\.me|api\.whatsapp\.com)\/[^\s]+/gi;
/** Phones only on one line — never cross newlines (that wiped ad stats/prices). */
const PHONE =
  /(?:^|[^\d])((?:\+|00)?(?:966|05|5)\d(?:[ \t\-()]*\d){7,12})(?!\d)/gm;
/** «حساب ببجي» / «حساب ببجي موبايل» with optional HTML bold — strip if present, never invent */
const PUBG_TITLE = /(?:<b>)?\s*حساب\s*ببجي(?:\s*موبايل)?\s*(?:<\/b>)?/gi;
/** Already has installments / متوفر offer — do not prepend another line */
const HAS_INSTALLMENTS_OR_AVAILABLE = /متوفر|اق[\u0640\s]*ساط|أق[\u0640\s]*ساط/i;
/** Inquiry chatter lines */
const INQUIRY_LINE =
  /^[^\n]*(?:استفسار|للاستفسار|اضغط(?:\s+هنا)?\s+للاستفسار)[^\n]*$/gim;
/**
 * Trader-group meta / chatter lines (not listing body) — strip from channel caption
 * even mid-body. Covers cancelled / reduced / renew / update notes.
 * Examples: تكنسلت بيعته، خفضت جددو لاهنتو، مخفض، عدلت سعره، تصميم ورفعت سعره، رفعت السعر، من يبي يعيده…
 */

/** Lines about someone else's account / favor / group chatter */
const TRADER_CHAT_LINE =
  /^[^\n]*(?:حساب\s+(?:اخوي|أخوي|رفيقي|صاحبي|فلان|شخص)|يعرفونهم|طاري\s*الفايد|نسبه\s*الفايد|نسبة\s*الفايد|عمول)[^\n]*$/gim;

/** صافي / net lines — trader-internal, never publish */
const SAFI_LINE = /(?:ال)?صاف[يى]/i;

const TRADER_META_LINE =
  /^[^\n]*(?:تكنسل(?:ت)?|كنسل(?:ت)?|ملغي(?:ة)?\s*البيع|تم\s*ال(?:الغاء|إلغاء)|بيعته\s*تكنسل|خفضت|مخف[\u0640\u0651]?\s*ض|مخفض|عد[\u0640\u0651]?لت\s*(?:ال)?سعر(?:ه|ها)?|تصميم\s*(?:و\s*)?رفع[\u0640\u0651]?ت(?:\s*(?:ال)?سعر(?:ه|ها)?)?|رفع[\u0640\u0651]?ت\s*(?:ال)?سعر(?:ه|ها)?|جددو|جددوه|لاهنتو|لاهنتوا|من\s*يبي\s*يعيد|اللي\s*(?:وده|يبي|ودّه)\s*(?:يعيد|ينزل)|حدّثو|حدثو|حدثوه|حدّثوه|الفايده|الفايدة|فايده|فايدة|محتاج\s*بيعته|تصوير\s*جديد|واجه(?:ه|ة)\s*جديد(?:ه|ة)|ناشب|طول\s*مره)[^\n]*$/gim;
/** Trader-only junk lines: «1450 تصوير», «تصميم - ربطه معي ومع», «صممت واجهه», «- جديد، الدولة 46 يوم ✅» */
const TJ_PART = String.raw`(?:تصميم|صممت\s*واجه[هة]|(?:ربطه|الربط)\s*معي(?:\s*ومع(?:\s+\S+)?)?)`;
const TRADER_JUNK_LINES: RegExp[] = [
  /^[\s\-–—|•*]*(?:\d{2,6}\s*تصوير|تصوير\s*\d{2,6})[\s.!،,]*$/gmu,
  new RegExp(String.raw`^[\s\-–—|•*]*${TJ_PART}(?:\s*[\-–—،,]?\s*${TJ_PART})*[\s.!،,]*$`, "gmu"),
  /^[\s\-–—|•*]*(?:جديد[\s،,]*)?(?:ال)?دول[ةه]\s*\d{1,4}\s*(?:يوم|أيام|ايام)[\s.!،,\u2705\u2714\uFE0F]*$/gmu,
  /^[\s\-–—|•*]*جديد[\s.!،,\u2705\u2714\uFE0F]*$/gmu,
  // سطر تخفيض التاجر: «- 1750 📎» / «-1750» / «— 1750 📎» (شرطة + رقم + إيموجي اختياري فقط)
  /^[ \t]*[\-–—][ \t]*[\d٠-٩][\d٠-٩,.]{1,7}[ \t]*(?:[\p{Extended_Pictographic}\uFE0F\u200D][ \t]*)*$/gmu,
];

/** Listing-body keywords — trailing lines without these (and without digits) are chatter */
const LISTING_BODY_KW =
  /(?:لفل|ميثك|مثك|ربط|ايميل|إيميل|قوقل|تويتر|سعر(?![هها])|بـ|UC|كونكر|خزن|مختبر|فيديو|الباقي|أقساط|اقساط|متوفر|وجه|سكن|إطار|ايطار|إيطارات|ايطارات)/i;
/** Ad-identity lines (DMSTOR only) — not game levels or prices */
const AD_NUMBER_LINE =
  /^[^\n]*(?:رقم\s*الإعلان|رقم\s*الاعلان|الإعلان\s*رقم|الاعلان\s*رقم)[^\n]*$/gim;
/** Solo short-code lines / >digits — avoid stripping in-body tokens like M416 */
const AD_SOLO_SHORT_CODE = /^(?:[A-Za-z]\d{2,6}|>\d{3,8})$/gm;
const AD_GT_CODE = /(?:^|\s)>\d{3,8}(?=\s|$)/gm;

/**
 * Trader-person linking chatter («الربط مع ايفورا»، dangling «الربط مع») —
 * NOT real account binding (تغير ايميل / ايميل ورقم / ربط قوقل / الربط : …).
 * «مع + name» is group chatter about who to link with.
 */
const TRADER_LINK_WITH_LINE =
  /^[^\n]*(?:^|[\s\-–—|•*])?(?:ال)?ربط\s+مع(?:\s+[^\n]*)?$/gim;
/** Inline leftover after line strip / mixed with dashes */
const TRADER_LINK_WITH_PHRASE =
  /(?:^|[\s\-–—|•*]+)(?:ال)?ربط\s+مع(?:\s+\S+)?/gi;

/**
 * Clean traders footer (جديد/مكرر, trader #tags/@handles), strip contact leaks,
 * keep body literally, ensure store owner @username ends the caption.
 * NEVER invent/change/add price (سعر / بـ / الىىىعر): if present, pass through as-is;
 * if absent, do not invent a price line.
 */
export const DMSTOR_INSTALLMENTS_LINE = "متوفر أقساط ( 4 , 6 , 8 , 12 ) دفعة";
/** Alias — installments apply to both mirror bots when missing from caption. */
export const TRADERS_INSTALLMENTS_LINE = DMSTOR_INSTALLMENTS_LINE;

export function isDmstorBot(botUsername?: string | null): boolean {
  return (botUsername ?? "").replace(/^@/, "").trim().toLowerCase() === "dmstor_bot";
}

/** Sultan store bot — traders mirror with rate-limited auto publish. */
/** Bots that get DMSTOR-style ad-number strip (same understanding as DMSTOR). */
export const AD_NUMBER_STRIP_BOTS = ["dmstor_bot", "sarhstoree_bot"] as const;

export function stripsAdNumbers(botUsername?: string | null): boolean {
  const u = (botUsername ?? "").replace(/^@/, "").trim().toLowerCase();
  return (AD_NUMBER_STRIP_BOTS as readonly string[]).includes(u);
}

export function isSultanBot(botUsername?: string | null): boolean {
  return ["sultan_sl_bot", "s3dstore_bot"].includes((botUsername ?? "").replace(/^@/, "").trim().toLowerCase());
}

function collapseWhitespace(text: string): string {
  return text
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripBareUsernameLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      // bare handle alone on a line (must include _ to avoid game-stat false positives)
      if (
        /^[A-Za-z][A-Za-z0-9_]*_[A-Za-z0-9_]{0,30}$/.test(t) &&
        t.length >= 5 &&
        t.length <= 32
      ) {
        return false;
      }
      return true;
    })
    .join("\n");
}

function stripDmstorAdNumbers(text: string): string {
  let out = text.replace(AD_NUMBER_LINE, "");
  out = out.replace(AD_SOLO_SHORT_CODE, "");
  out = out.replace(AD_GT_CODE, " ");
  return out;
}

/**
 * Drop trailing standalone trader notes: any trailing line with no digits and
 * no listing keywords (وصف/سعر/ربط/…). Applied after TRADER_META_LINE strip.
 */
function stripTrailingTraderNotes(text: string): string {
  const lines = text.split("\n");
  while (lines.length > 0) {
    const last = (lines[lines.length - 1] ?? "").trim();
    if (!last) {
      lines.pop();
      continue;
    }
    if (/\d/.test(last) || LISTING_BODY_KW.test(last)) {
      break;
    }
    lines.pop();
  }
  return lines.join("\n");
}

/**
 * Drop صافي lines + trailing lone numbers after a listing price (trader net).
 * Keeps the first/main price line (بـ / سعر / …); strips extra bare numbers below.
 */
function stripSafiAndTrailingLonePrices(text: string): string {
  let lines = text.split("\n").filter((line) => {
    const t = line.trim();
    if (!t) return true;
    return !/(?:ال)?صاف[يى]/i.test(t);
  });

  // Public listing price markers — include قيمه/قيمة (common trader phrasing)
  const lineHasPrice = (s: string) =>
    /(?:بـ|بِ|سعر|(?:ال)?قيم[ةه]|الى|إلى)\s*:?\s*\d/.test(s) ||
    /:\s*\d{3,6}\s*$/.test(s.trim()) ||
    /^\d{3,6}(?:\s*ريال)?$/.test(s.trim());

  while (lines.length > 0) {
    const last = (lines[lines.length - 1] ?? "").trim();
    if (!last) {
      lines.pop();
      continue;
    }
    // Bare number only (صافي), and an earlier price already exists above
    if (/^\d{2,6}$/.test(last)) {
      const earlierHasPrice = lines.slice(0, -1).some((l) => lineHasPrice(l));
      if (earlierHasPrice) {
        lines.pop();
        continue;
      }
    }
    break;
  }
  return lines.join("\n");
}

/**
 * Drop «الربط مع …» trader junk lines/phrases; keep real binding wording.
 */
function stripTraderLinkWithJunk(text: string): string {
  let out = text.replace(TRADER_LINK_WITH_LINE, "");
  out = out.replace(TRADER_LINK_WITH_PHRASE, " ");
  // Lone dash/punct debris left after status + link-with strips (e.g. "- -" ".")
  out = out
    .split("\n")
    .map((line) => line.replace(/^[\s\-–—|•*.,،:]+$/, "").trimEnd())
    .join("\n");
  return out;
}

function maybePrependInstallments(text: string): string {
  if (HAS_INSTALLMENTS_OR_AVAILABLE.test(text)) {
    return text;
  }
  return text ? `${TRADERS_INSTALLMENTS_LINE}\n\n${text}` : TRADERS_INSTALLMENTS_LINE;
}

export function rewriteTradersCaption(
  caption: string,
  ownerUsername: string,
  opts?: { botUsername?: string },
): string {
  const owner = ownerUsername.replace(/^@/, "").trim();
  const dmstor = stripsAdNumbers(opts?.botUsername);
  let text = (caption ?? "").replace(/\r\n/g, "\n");

  text = text.replace(STATUS_TOKEN, " ");
  text = text.replace(PUBG_TITLE, "");
  text = text.replace(INQUIRY_LINE, "");
  // Strip trader meta/chatter lines anywhere in caption (not only trailing)
  text = text.replace(TRADER_META_LINE, "");
  for (const re of TRADER_JUNK_LINES) text = text.replace(re, "");
  text = text.replace(TRADER_CHAT_LINE, "");
  // «الربط مع فلان» / dangling «الربط مع» — trader junk, not account binding
  text = stripTraderLinkWithJunk(text);
  // صافي handled in stripSafiAndTrailingLonePrices (line-level)
  text = text.replace(HASHTAG, "");
  text = text.replace(TELEGRAM_LINK, "");
  text = text.replace(WA_LINK, "");
  text = text.replace(PHONE, (full, num) => full.slice(0, full.length - num.length));
  // Strip ALL @handles first; owner is re-appended once at the end
  text = text.replace(USERNAME, "");
  text = stripBareUsernameLines(text);

  if (dmstor) {
    text = stripDmstorAdNumbers(text);
  }

  text = collapseWhitespace(text);
  text = text.replace(/(?:واتس(?:اب)?|كلمني|على الخاص|رقمي)\s*/gi, "").trim();
  text = collapseWhitespace(text);

  text = stripTraderLinkWithJunk(text);
  text = stripTrailingTraderNotes(text);
  text = stripSafiAndTrailingLonePrices(text);
  text = collapseWhitespace(text);

  // Both dmstor_bot and sarhstoree_bot: prepend installments only when missing
  if (isSultanBot(opts?.botUsername)) {
    text = toSultanPriceStyle(text);
  }
  const noInstallments = (opts?.botUsername ?? "").replace(/^@/, "").trim().toLowerCase() === "sarhstoree_bot";
  if (noInstallments) {
    // sarhstoree: never show installments — strip seller-supplied line too
    text = text
      .split("\n")
      .filter((line) => !/(?:متوفر\s*)?[أا]ق[\u0640\s]*ساط/i.test(line))
      .join("\n");
    text = collapseWhitespace(text);
  } else {
    text = maybePrependInstallments(text);
  }

  const ownerTag = `@${owner}`;
  if (owner) {
    const ownerRe = new RegExp(
      `(?:@|＠)${owner.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "gi",
    );
    text = text.replace(ownerRe, "").trim();
    text = collapseWhitespace(text);
    text = text ? `${text}\n\n${ownerTag}` : ownerTag;
  }

  return fitCaption(escapeHtml(text));
}


/**
 * True when caption has enough listing body after rewrite strips installments + owner.
 * Used to decide immediate publish vs wait ~2min for caption edit/reply.
 */

/**
 * Group-owner admin chatter (not an ad) — never mirror to the store channel.
 * e.g. «صفى الحسابات المباعه», «صفيت المباعة», «مسحت الحسابات المباعة من القروب».
 */
export function isTradersGroupAdminNotice(text: string): boolean {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return false;
  // Must look like a cleanup / clear notice about sold accounts — not a listing body
  const cleanupVerb =
    /(?:صف[\u0640\u0651]?[ىي]|صفّ[ىي]|صفيت|صفّيت|صفينا|صفوا|مسح(?:ت|نا|وا)?|نظ[\u0640\u0651]?ف(?:ت|نا)?|حذف(?:ت|نا|وا)?|شل(?:ت|نا)|خلصت|ركنت|نظّفت)/i;
  const soldAccounts =
    /(?:الحسابات\s*)?(?:المباعه|المباعة|المباع)|(?:الإعلانات|الاعلانات)\s*(?:المباعه|المباعة)|حسابات\s*مباعه?|إعلانات\s*مباعه?|اعلانات\s*مباعه?/i;
  if (cleanupVerb.test(t) && soldAccounts.test(t)) return true;
  // Short standalone variants: «صفى المباعه», «صفيت المباعة»
  if (/(?:صف[\u0640\u0651]?[ىي]|صفّ[ىي]|صفيت|صفّيت)\s*(?:الحسابات\s*)?(?:المباعه|المباعة)\b/i.test(t)) {
    return true;
  }
  return false;
}

export function hasUsableTradersCaption(
  raw: string,
  ownerUsername: string,
  botUsername?: string | null,
): boolean {
  if (isTradersGroupAdminNotice(raw ?? "")) return false;
  const rewritten = rewriteTradersCaption(raw ?? "", ownerUsername, {
    botUsername: botUsername ?? undefined,
  });
  const owner = ownerUsername.replace(/^@/, "").trim();
  let body = rewritten;
  // Strip the synthetic installments line (and any accidental duplicate)
  body = body.split(TRADERS_INSTALLMENTS_LINE).join("");
  if (owner) {
    const ownerRe = new RegExp(
      `(?:@|＠)${owner.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "gi",
    );
    body = body.replace(ownerRe, "");
  }
  body = body.replace(/\n{2,}/g, "\n").replace(/[^\S\n]+/g, " ").trim();
  return body.length >= 12;
}

/** Extract photo/video file_id from a Telegram message-like object. */
export function mediaFromMessage(message: {
  photo?: Array<{ file_id: string }>;
  video?: { file_id: string };
  animation?: { file_id: string };
  document?: { file_id: string; mime_type?: string };
}): { kind: "photo" | "video"; fileId: string } | null {
  if (message.video?.file_id) return { kind: "video", fileId: message.video.file_id };
  if (message.animation?.file_id) return { kind: "video", fileId: message.animation.file_id };
  const photos = message.photo;
  if (photos && photos.length > 0) {
    return { kind: "photo", fileId: photos[photos.length - 1]!.file_id };
  }
  const doc = message.document;
  if (doc?.file_id && doc.mime_type?.startsWith("video/")) {
    return { kind: "video", fileId: doc.file_id };
  }
  if (doc?.file_id && doc.mime_type?.startsWith("image/")) {
    return { kind: "photo", fileId: doc.file_id };
  }
  return null;
}

const SULTAN_PRICE_LINE =
  /(^|\n)([^\n]*?)[ \t]*(?:ال)?(?:سعر|قيمة|قيمه)[ \t]*[:：\-–=]?[ \t]*(\d[\d,.]*)[ \t]*(?:ريال|ر\.?س|sar)?[ \t.]*(?=\n|$)/i;
const SULTAN_BA = /بـ\s*\d/;

/** Sultan: «القيمة: 3450» / «السعر 3450» → «بـ 3450». إذا فيه «بـ N» نخليه. */
export function toSultanPriceStyle(text: string): string {
  if (SULTAN_BA.test(text)) return text;
  return text.replace(SULTAN_PRICE_LINE, (_m, nl, prefix, num) => {
    const head = String(prefix ?? "").trimEnd();
    return `${nl}${head ? `${head} ` : ""}بـ ${String(num).replace(/[.,]$/, "")}`;
  });
}

/** Sultan: عدّل/أضف «بـ N» بالكابشن (بعد rewrite) */
export function setSultanPrice(caption: string, price: number): string {
  const v = String(Math.round(price));
  if (/بـ\s*\d[\d,.]*/.test(caption)) return caption.replace(/بـ\s*\d[\d,.]*/, `بـ ${v}`);
  const m = caption.match(/\n\n(@\w+)\s*$/);
  if (m) return `${caption.slice(0, m.index)}\nبـ ${v}\n\n${m[1]}`;
  return `${caption}\nبـ ${v}`;
}

/** DMSTOR: عدّل أي سعر موجود («بـ N» / «السعر: N» / «القيمة: N»)، وإلا أضف «بـ N» قبل يوزر المالك */
export function setMirrorPrice(caption: string, price: number): string {
  const v = String(Math.round(price));
  if (/بـ\s*:?\s*\d[\d,.]*/.test(caption)) return caption.replace(/(بـ\s*:?\s*)\d[\d,.]*/, `$1${v}`);
  const re = /((?:ال)?(?:سعر|قيمة|قيمه)\s*[:：\-–=]?\s*)\d[\d,.]*/;
  if (re.test(caption)) return caption.replace(re, `$1${v}`);
  return setSultanPrice(caption, price);
}
