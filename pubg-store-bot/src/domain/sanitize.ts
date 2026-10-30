const TELEGRAM_LINK =
  /(?:https?:\/\/)?(?:t(?:elegram)?\.me|telegram\.dog)\/[^\s]+/gi;
const USERNAME = /@[A-Za-z0-9_]{4,32}/g;
const PHONE = /(?:\+|00)?(?:\d[\s\-()]*){8,15}\d/g;
const WA_LINK = /(?:https?:\/\/)?(?:wa\.me|api\.whatsapp\.com)\/[^\s]+/gi;

export function sanitizeListingText(input: string): string {
  let text = input;
  text = text.replace(TELEGRAM_LINK, "");
  text = text.replace(WA_LINK, "");
  text = text.replace(USERNAME, "");
  text = text.replace(PHONE, "");
  text = text.replace(/[^\S\n]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

export function collectMentions(text: string): string[] {
  return (text.match(/@[A-Za-z0-9_]{4,32}/g) ?? []).map((item) =>
    item.slice(1).toLowerCase(),
  );
}

export function unexpectedMentions(caption: string, ownerUsername: string): string[] {
  const owner = ownerUsername.replace(/^@/, "").toLowerCase();
  return collectMentions(caption).filter((name) => name !== owner);
}

export function hasContactHints(text: string): boolean {
  return (
    /(?:https?:\/\/)?(?:t(?:elegram)?\.me|telegram\.dog)\//i.test(text) ||
    /(?:https?:\/\/)?(?:wa\.me|api\.whatsapp\.com)\//i.test(text) ||
    /@[A-Za-z0-9_]{4,32}/.test(text) ||
    /(?:\+|00)?(?:\d[\s\-()]*){8,15}\d/.test(text) ||
    /واتس(?:اب)?|كلمني|على الخاص|رقمي/i.test(text)
  );
}
