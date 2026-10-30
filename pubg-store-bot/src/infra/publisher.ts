import { InlineKeyboard, type Api } from "grammy";

export interface ListingPublishInput {
  videoFileId: string;
  caption: string;
  replyMarkup?: InlineKeyboard;
  /** photo إذا الملف صورة تيليجرام؛ غير ذلك فيديو */
  mediaKind?: "video" | "photo";
}

export interface PublishedChannelMessage {
  messageId: number;
  videoMessageId?: number;
}

export interface ChannelPublisher {
  sendVideo(
    channelId: string,
    fileId: string,
    caption: string,
  ): Promise<{ messageId: number }>;
  sendListing(channelId: string, input: ListingPublishInput): Promise<PublishedChannelMessage>;
  editCaption(
    channelId: string,
    messageId: number,
    caption: string,
    replyMarkup?: InlineKeyboard,
  ): Promise<void>;
  deleteMessage(channelId: string, messageId: number): Promise<void>;
}

export function createTelegramPublisher(api: Api): ChannelPublisher {
  return {
    async sendVideo(channelId, fileId, caption) {
      const message = await api.sendVideo(channelId, fileId, {
        caption,
        parse_mode: "HTML",
      });
      return { messageId: message.message_id };
    },
    async sendListing(channelId, input) {
      const opts = {
        caption: input.caption,
        parse_mode: "HTML" as const,
        ...(input.replyMarkup ? { reply_markup: input.replyMarkup } : {}),
      };
      if (input.mediaKind === "photo") {
        const message = await api.sendPhoto(channelId, input.videoFileId, opts);
        return { messageId: message.message_id };
      }
      try {
        const message = await api.sendVideo(channelId, input.videoFileId, opts);
        return { messageId: message.message_id };
      } catch {
        // file_id قد يكون صورة مخزّنة في عمود الفيديو
        const message = await api.sendPhoto(channelId, input.videoFileId, opts);
        return { messageId: message.message_id };
      }
    },
    async editCaption(channelId, messageId, caption, replyMarkup) {
      await api.editMessageCaption(channelId, messageId, {
        caption,
        parse_mode: "HTML",
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      });
    },
    async deleteMessage(channelId, messageId) {
      await api.deleteMessage(channelId, messageId);
    },
  };
}
