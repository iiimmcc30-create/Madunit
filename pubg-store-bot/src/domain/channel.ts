export const SETUP_CHANNEL_REQUEST_ID = 7101;
export const SETUP_GROUP_REQUEST_ID = 7102;

export type ChannelBindKind =
  | "id"
  | "username"
  | "url"
  | "forward"
  | "chat_shared"
  | "hidden_forward"
  | "user_forward"
  | "group_forward"
  | "unknown";

export interface ChannelBindHit {
  kind: Exclude<ChannelBindKind, "hidden_forward" | "user_forward" | "group_forward" | "unknown">;
  value: string;
}

export interface ChannelBindMiss {
  kind: "hidden_forward" | "user_forward" | "group_forward" | "unknown";
}

export type ChannelBindResult = ChannelBindHit | ChannelBindMiss;

export interface SetupInputLog {
  hasMessage: boolean;
  contentType: string;
  forwardOriginType: string | null;
  hasForwardFromChat: boolean;
  forwardFromChatType: string | null;
  hasForwardDate: boolean;
  hasChatShared: boolean;
  chatSharedRequestId: number | null;
  hasText: boolean;
  hasCaption: boolean;
  textShape: string;
}

export function isChannelAdministrator(status: string, canPostMessages?: boolean | null): boolean {
  if (status === "creator") return true;
  if (status !== "administrator") return false;
  return canPostMessages !== false;
}

export function isGroupChatType(type: string | undefined): boolean {
  return type === "group" || type === "supergroup";
}

/**
 * What the bot still lacks to publish in the target.
 * Channel: admin + can_post_messages. Group/supergroup: admin + can send + can delete
 * (sold/deleted listings get removed). Plain groups have no granular rights, admin is enough.
 */
export function missingChannelAdminPermissions(input: {
  chatType?: string;
  status: string;
  canPostMessages?: boolean | null;
  canDeleteMessages?: boolean | null;
  canSendMessages?: boolean | null;
}): string[] {
  const isChannel = input.chatType === "channel";
  const place = isChannel ? "عضوية القناة" : "عضوية المجموعة";
  if (input.status === "creator") return [];
  if (input.status === "left" || input.status === "kicked") {
    return isChannel ? [place, "أدمن", "نشر الرسائل"] : [place, "أدمن", "إرسال الرسائل", "حذف الرسائل"];
  }
  if (input.status !== "administrator") {
    return isChannel ? ["أدمن", "نشر الرسائل"] : ["أدمن", "حذف الرسائل"];
  }
  if (isChannel) {
    return input.canPostMessages !== true ? ["نشر الرسائل"] : [];
  }
  const missing: string[] = [];
  if (input.canSendMessages === false) missing.push("إرسال الرسائل");
  if (input.canDeleteMessages === false) missing.push("حذف الرسائل");
  return missing;
}

export function formatMissingPermissions(missing: string[], chatType?: string): string {
  const place = chatType === "channel" ? "القناة" : chatType && isGroupChatType(chatType) ? "المجموعة" : "القناة أو المجموعة";
  if (missing.length === 0) return `البوت لازم يكون أدمن في ${place} ويقدر ينشر.`;
  return `البوت لازم يكون أدمن في ${place} ويقدر ينشر.\nالصلاحية الناقصة: ${missing.join("، ")}.`;
}

/** Public link to a message: t.me/<user>/<id> or t.me/c/<internal>/<id> for private -100 chats. */
export function messageLink(chatId: string, messageId: number, username?: string | null): string | null {
  const user = (username ?? "").replace(/^@/, "");
  if (user) return `https://t.me/${user}/${messageId}`;
  const m = String(chatId).match(/^-100(\d+)$/);
  return m ? `https://t.me/c/${m[1]}/${messageId}` : null;
}

export function normalizeChannelId(raw: string): string | null {
  const text = raw.trim();
  if (/^-100\d{5,}$/.test(text)) return text;
  if (/^100\d{5,}$/.test(text)) return `-${text}`;
  if (/^-\d{6,}$/.test(text)) return text;
  return null;
}

export function parseChannelId(input: string): string | null {
  const text = input.trim();
  const direct = normalizeChannelId(text);
  if (direct) return direct;
  const labeled = text.match(/channel[_\s-]?id\s*[:=]?\s*(-?100\d{5,}|-?\d{6,})/i);
  if (labeled?.[1]) return normalizeChannelId(labeled[1]);
  const link = parseChannelLink(text);
  return link?.kind === "id" ? link.value : null;
}

export function parseChannelUsername(input: string): string | null {
  const text = input.trim();
  const mention = text.match(/^@([A-Za-z][A-Za-z0-9_]{3,31})$/);
  if (mention) return mention[1];
  const bare = text.match(/^([A-Za-z][A-Za-z0-9_]{4,31})$/);
  if (bare && !/^\d+$/.test(bare[1])) return bare[1];
  return null;
}

export function parseChannelLink(input: string): ChannelBindHit | null {
  const text = input.trim();
  const tme = text.match(
    /(?:https?:\/\/)?(?:t\.me|telegram\.me|telegram\.dog)\/(?:s\/)?([^\s/?]+)/i,
  );
  if (!tme) return null;
  const slug = tme[1].replace(/\/+$/, "").split("/")[0];
  if (!slug) return null;
  if (slug === "c") {
    const internal = text.match(
      /(?:t\.me|telegram\.me|telegram\.dog)\/c\/(\d{5,})/i,
    );
    if (!internal) return null;
    const id = normalizeChannelId(internal[1].startsWith("100") ? internal[1] : `100${internal[1]}`);
    return id ? { kind: "id", value: id } : null;
  }
  if (slug.startsWith("+") || slug === "joinchat") return null;
  const user = slug.replace(/^@/, "");
  if (/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(user)) {
    return { kind: "username", value: user };
  }
  return null;
}

export function parseChannelRef(input: string): ChannelBindHit | null {
  const text = input.trim();
  const id = parseChannelId(text);
  if (id) return { kind: "id", value: id };
  const link = parseChannelLink(text);
  if (link) return link;
  const username = parseChannelUsername(text);
  if (username) return { kind: "username", value: username };
  return null;
}

export function extractForwardedChatId(message: {
  forward_origin?: {
    type?: string;
    chat?: { id?: number | string; type?: string };
    sender_chat?: { id?: number | string; type?: string };
  };
  forward_from_chat?: { id?: number | string; type?: string };
}): string | null {
  const origin = message.forward_origin;
  const originId = origin?.chat?.id ?? origin?.sender_chat?.id;
  if (originId != null && origin?.type !== "user" && origin?.type !== "hidden_user") {
    return String(originId);
  }
  if (message.forward_from_chat?.id != null) {
    const type = message.forward_from_chat.type;
    if (!type || type === "channel" || type === "supergroup") {
      return String(message.forward_from_chat.id);
    }
  }
  return null;
}

export function parseSetupChannelInput(input: {
  message?: SetupMessage | undefined;
}): ChannelBindResult {
  const message = input.message;
  if (!message) return { kind: "unknown" };

  if (message.chat_shared?.chat_id != null) {
    return { kind: "chat_shared", value: String(message.chat_shared.chat_id) };
  }

  const forwardedId = extractForwardedChatId(message);
  if (forwardedId) return { kind: "forward", value: forwardedId };

  if (isHiddenChannelForward(message)) return { kind: "hidden_forward" };
  if (isUserForward(message)) return { kind: "user_forward" };

  const text = (message.text ?? message.caption ?? "").trim();
  if (text) {
    const parsed = parseChannelRef(text);
    if (parsed) return parsed;
  }
  return { kind: "unknown" };
}

export function isHiddenChannelForward(message: {
  forward_origin?: { type?: string; chat?: { id?: number | string }; sender_chat?: { id?: number | string } };
  forward_from_chat?: { id?: number | string };
  forward_date?: unknown;
  forward_sender_name?: string;
}): boolean {
  if (extractForwardedChatId(message)) return false;
  const originType = message.forward_origin?.type;
  if (originType === "hidden_user") return true;
  if (originType === "user") return false;
  if (message.forward_sender_name) return true;
  return Boolean(message.forward_date || originType);
}

export function isUserForward(message: {
  forward_origin?: { type?: string };
  forward_from?: unknown;
}): boolean {
  if (message.forward_origin?.type === "user") return true;
  return Boolean(message.forward_from) && !message.forward_origin;
}

export function describeSetupInput(input: { message?: SetupMessage | undefined }): SetupInputLog {
  const message = input.message;
  const text = (message?.text ?? message?.caption ?? "").trim();
  return {
    hasMessage: Boolean(message),
    contentType: setupContentType(message),
    forwardOriginType: message?.forward_origin?.type ?? null,
    hasForwardFromChat: Boolean(message?.forward_from_chat),
    forwardFromChatType: message?.forward_from_chat?.type ?? null,
    hasForwardDate: Boolean(message?.forward_date),
    hasChatShared: Boolean(message?.chat_shared),
    chatSharedRequestId: message?.chat_shared?.request_id ?? null,
    hasText: Boolean(message?.text),
    hasCaption: Boolean(message?.caption),
    textShape: describeTextShape(text),
  };
}

function describeTextShape(text: string): string {
  if (!text) return "empty";
  if (/^\d+:[A-Za-z0-9_-]{20,}$/.test(text)) return "redacted-token";
  if (normalizeChannelId(text) || parseChannelId(text)) return "numeric-id";
  if (parseChannelLink(text)) return "tme-link";
  if (parseChannelUsername(text)) return "username";
  if (text.startsWith("/")) return "command";
  return "other";
}

function setupContentType(message: SetupMessage | undefined): string {
  if (!message) return "none";
  if (message.chat_shared) return "chat_shared";
  if (message.video) return "video";
  if (message.photo) return "photo";
  if (message.document) return "document";
  if (message.text) return "text";
  if (message.caption) return "caption";
  return "other";
}

export interface SetupMessage {
  text?: string;
  caption?: string;
  photo?: unknown;
  video?: unknown;
  document?: unknown;
  forward_date?: number;
  forward_sender_name?: string;
  forward_from?: unknown;
  forward_from_chat?: { id?: number | string; type?: string };
  forward_origin?: {
    type?: string;
    chat?: { id?: number | string; type?: string };
    sender_chat?: { id?: number | string; type?: string };
  };
  chat_shared?: { request_id?: number; chat_id?: number | string };
}

export function toTelegramChatRef(hit: ChannelBindHit): string {
  if (hit.kind === "username") return `@${hit.value.replace(/^@/, "")}`;
  return hit.value;
}

/** Forwarded from a group / discussion supergroup instead of the channel itself. */
export function isGroupForward(message: {
  forward_origin?: { type?: string; chat?: { type?: string }; sender_chat?: { type?: string } };
  forward_from_chat?: { type?: string };
}): boolean {
  const origin = message.forward_origin;
  if (origin?.type === "chat") {
    const type = origin.sender_chat?.type ?? origin.chat?.type;
    return type === "group" || type === "supergroup";
  }
  if (origin?.type === "channel") return false;
  const legacy = message.forward_from_chat?.type;
  return legacy === "group" || legacy === "supergroup";
}
