/** خريطة كيبورد إنجليزي → عربي (تخطيط IBM العربي الشائع في الخليج). */
const EN_TO_AR: Record<string, string> = {
  q: "ض",
  w: "ص",
  e: "ث",
  r: "ق",
  t: "ف",
  y: "غ",
  u: "ع",
  i: "ه",
  o: "خ",
  p: "ح",
  "[": "ج",
  "]": "د",
  a: "ش",
  s: "س",
  d: "ي",
  f: "ب",
  g: "ل",
  h: "ا",
  j: "ت",
  k: "ن",
  l: "م",
  ";": "ك",
  "'": "ط",
  z: "ئ",
  x: "ء",
  c: "ؤ",
  v: "ر",
  b: "لا",
  n: "ى",
  m: "ة",
  ",": "و",
  ".": "ز",
  "/": "ظ",
  "`": "ذ",
};

const ARABIC_MARKET =
  /(سو|كم|حساب|بيع|نزل|اعلن|أعلن|ابي|أبغ|سعر|فل|مثالي|ربط|اعلان|إعلان|دور|بلغن|انشر)/;
const ENGLISH_KEEP =
  /\b(how|what|price|account|hello|please|yes|no|ok|hi|pubg|level|google|facebook|twitter|apple|sold|delete|under)\b/i;

export function decodeEnglishKeyboardArabic(text: string): string {
  return [...text].map((ch) => EN_TO_AR[ch.toLowerCase()] ?? ch).join("");
}

export function looksLikeEnglishKeyboardArabic(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || ENGLISH_KEEP.test(trimmed) || /\bA\d{1,6}\b/i.test(trimmed)) return false;
  const letters = trimmed.replace(/\s+/g, "");
  if (!letters) return false;
  const latin = letters.replace(/[^A-Za-z,;'\[\]`.\/]/g, "");
  if (latin.length / letters.length < 0.6) return false;
  const decoded = decodeEnglishKeyboardArabic(trimmed);
  if (decoded === trimmed) return false;
  if (ARABIC_MARKET.test(decoded)) return true;
  return trimmed.length <= 16 && /[اأإء-ي]/.test(decoded);
}

export function normalizeUserText(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (!collapsed) return "";
  if (looksLikeEnglishKeyboardArabic(collapsed)) {
    return decodeEnglishKeyboardArabic(collapsed);
  }
  return collapsed;
}
