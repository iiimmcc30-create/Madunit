import { extractForwardedChatId } from "./channel";
import { normalizeShortCode } from "./short-code";

export interface ForwardedChannelRef {
  channelId: string;
  messageId: number;
}

export function detectInquiryCode(text: string): string | null {
  return normalizeShortCode(text);
}

export function parseForwardedChannel(message: {
  forward_origin?: {
    type?: string;
    chat?: { id?: number | string };
    sender_chat?: { id?: number | string };
    message_id?: number;
  };
  forward_from_chat?: { id?: number | string; type?: string };
  forward_from_message_id?: number;
}): ForwardedChannelRef | null {
  const channelId = extractForwardedChatId(message);
  if (!channelId) return null;
  const messageId = message.forward_origin?.message_id ?? message.forward_from_message_id;
  if (messageId == null) {
    return { channelId, messageId: 0 };
  }
  return { channelId, messageId };
}

export function isForwardedMessage(message: {
  forward_origin?: unknown;
  forward_from_chat?: unknown;
  forward_from?: unknown;
  forward_date?: unknown;
}): boolean {
  return Boolean(
    message.forward_origin ||
      message.forward_from_chat ||
      message.forward_from ||
      message.forward_date,
  );
}

export function inquiryJobDelays(timeoutMinutes: number, graceMinutes: number) {
  return {
    reminderMs: timeoutMinutes * 60_000,
    timeoutMs: (timeoutMinutes + graceMinutes) * 60_000,
  };
}
