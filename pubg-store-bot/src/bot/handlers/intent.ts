import { AppError } from "../../domain/errors";
import { isForwardedMessage, parseForwardedChannel } from "../../domain/inquiry-detect";
import { isPrivateAgentDisabled } from "../../domain/private-agent";
import { tryPrivateDirectPublish } from "./private-direct-publish";
import { tryPriceDrop } from "./price-drop";
import {
  isBareSellIntent,
  looksLikeAvailabilityAsk,
  looksLikeBuyerListingLookup,
  looksLikeOwnerAdmin,
  looksLikeSellIntent,
} from "../../agent/heuristic";
import type { AgentMedia } from "../../agent/tools";
import type { BotContext } from "../context";
import type { AppDeps } from "../deps";
import { agentConfirmKeyboard } from "../keyboards";
import { texts } from "../texts";
import type { Bot } from "grammy";

export const SELL_PROMPT =
  "حيّاك 👌 عشان أنشر إعلانك أرسل:\n1) فيديو أو صورة للحساب\n2) وصف الحساب\n3) السعر\n(تقدر ترسلها كلها برسالة وحدة: الفيديو مع الوصف والسعر)";
export const FALLBACK_PROMPT =
  "هلا 👋 اكتب طلبك: تبي تنشر إعلان (أرسل فيديو/صورة + وصف + سعر) ولا تسأل عن إعلان موجود (أرسل رقم الإعلان أو حوّله).";

function spokenText(ctx: BotContext): string {
  return (ctx.message?.text ?? ctx.message?.caption ?? "").trim();
}

function shouldSkipAgent(ctx: BotContext): boolean {
  if (ctx.chat?.type !== "private") return true;
  if (!ctx.from) return true;
  const text = spokenText(ctx);
  if (text.startsWith("/")) return true;
  if (looksLikeOwnerAdmin(text)) {
    ctx.session.pendingSellerPriceInquiryId = undefined;
    ctx.session.pendingStoreSetting = undefined;
    ctx.session.pendingAdminAction = undefined;
    return false;
  }
  if (ctx.conversation.active("setupStore") > 0) return true;
  if (ctx.conversation.active("openScrim") > 0) return true;
  if (ctx.conversation.active("registerScrim") > 0) return true;
  if (ctx.session.pendingSellerPriceInquiryId) return true;
  if (ctx.session.pendingStoreSetting) return true;
  if (ctx.session.pendingAdminAction) return true;
  if (ctx.session.pendingSubscriptionReceipt) return true;
  if (ctx.session.pendingReceiptListingId) return true;
  if (ctx.session.pendingScrimSetting) return true;
  if (ctx.session.pendingScrimRosterEdit) return true;
  if (ctx.session.pendingScrimAddTeam) return true;
  if (ctx.session.pendingScrimRemoveTeam) return true;
  if (ctx.session.pendingScrimResultEdit) return true;
  return false;
}

async function collectMedia(ctx: BotContext, deps: AppDeps): Promise<{ media: AgentMedia; text: string }> {
  const message = ctx.message;
  const caption = (message?.caption ?? message?.text ?? "").trim();
  const media: AgentMedia = {};
  if (!message) return { media, text: caption };

  const photo = message.photo?.at(-1);
  if (photo) {
    media.photoFileId = photo.file_id;
    try {
      const file = await deps.downloadTelegramFile(photo.file_id, true);
      if (file?.dataUrl) media.imageDataUrl = file.dataUrl;
    } catch (error) {
      deps.logger.warn({ err: error }, "photo download for vision failed");
    }
  }
  if (message.video) {
    media.videoFileId = message.video.file_id;
    media.videoUniqueId = message.video.file_unique_id;
  }
  const voice = message.voice ?? message.audio;
  if (voice) {
    media.voiceFileId = voice.file_id;
    try {
      const file = await deps.downloadTelegramFile(voice.file_id);
      if (file && deps.llm.transcribeAudio) {
        const transcribed = await deps.llm.transcribeAudio({
          buffer: file.buffer,
          fileName: file.fileName,
          mime: file.mime,
        });
        media.transcribedText = transcribed.text;
      }
    } catch (error) {
      deps.logger.warn({ err: error }, "voice transcribe failed");
    }
  }
  const text = [caption, media.transcribedText].filter(Boolean).join("\n").trim();
  return { media, text };
}

export function registerIntentHandlers(bot: Bot<BotContext>, deps: AppDeps) {
  bot.callbackQuery(/^ag:(ok|no)$/, async (ctx) => {
    const telegramId = String(ctx.from?.id ?? "");
    await ctx.answerCallbackQuery();
    if (isPrivateAgentDisabled(deps.botUsername)) {
      await deps.agent.memory.takeConfirm(deps.storeId, telegramId).catch(() => undefined);
      await ctx.reply(texts.privateAgentOff);
      return;
    }
    const pending = await deps.agent.memory.takeConfirm(deps.storeId, telegramId);
    if (!pending) {
      await ctx.reply("ما في إجراء منتظر تأكيد.");
      return;
    }
    if (ctx.callbackQuery.data === "ag:no") {
      await ctx.reply("تمام، لغيت.");
      return;
    }
    try {
      const reply = await deps.agent.reply({
        telegramId,
        text: pending.summary,
        storeId: deps.storeId,
        confirmed: pending,
      });
      await ctx.reply(reply.text, reply.pendingConfirm ? { reply_markup: agentConfirmKeyboard() } : undefined);
    } catch (error) {
      deps.logger.error({ err: error }, "agent confirm failed");
      await ctx.reply(error instanceof AppError ? error.userMessage : "صار خطأ، حاول مرة ثانية.");
    }
  });

  bot.on("message", async (ctx, next) => {
    if (shouldSkipAgent(ctx)) {
      await next();
      return;
    }
    // DMSTOR only: no private MAD AI / LLM spend; traders mirror is separate (groups).
    if (isPrivateAgentDisabled(deps.botUsername)) {
      await ctx.reply(texts.privateAgentOff);
      return;
    }
    if (ctx.conversation.active("createListing") > 0) {
      if (looksLikeOwnerAdmin(spokenText(ctx))) {
        await ctx.conversation.exit("createListing");
      } else {
        await next();
        return;
      }
    }
    if (ctx.conversation.active("setupStore") > 0 && looksLikeOwnerAdmin(spokenText(ctx))) {
      await ctx.conversation.exit("setupStore");
    }
    if (ctx.message && isForwardedMessage(ctx.message) && parseForwardedChannel(ctx.message)) {
      await next();
      return;
    }

    // sarhstoree: البائع يخفّض سعر إعلانه → رد على الإعلان بالقناة
    try {
      if (await tryPriceDrop(ctx, deps)) return;
    } catch (error) {
      deps.logger.warn({ err: error }, "price drop failed");
    }
    // sarhstoree: seller media+caption → DMSTOR pipeline, publish immediately
    try {
      if (await tryPrivateDirectPublish(ctx, deps)) return;
    } catch (error) {
      deps.logger.warn({ err: error }, "private direct publish check failed");
    }
    const { media, text } = await collectMedia(ctx, deps);
    const hasMedia = Boolean(media.photoFileId || media.videoFileId);
    const draftNow = await deps.agent.memory?.getDraft?.(deps.storeId, String(ctx.from?.id ?? "")).catch(() => null);
    if (!draftNow && !hasMedia && !(ctx.message && isForwardedMessage(ctx.message)) && isBareSellIntent(text)) {
      await ctx.reply(SELL_PROMPT);
      return;
    }
    const forwardedAny = Boolean(ctx.message && isForwardedMessage(ctx.message));
    // تحويل غير قناة / لصق إعلان موجود = تحقق توفر، مو مسودة نشر
    // بائع عنده مسودة ويرسل الوصف/السعر = تكملة إعلان، مو بحث مشتري
    const openDraft =
      !forwardedAny && text
        ? await deps.agent.memory?.getDraft?.(deps.storeId, String(ctx.from?.id ?? "")).catch(() => null)
        : null;
    const continuingDraft = Boolean(openDraft) && !looksLikeAvailabilityAsk(text);
    const treatAsLookup =
      !continuingDraft && !looksLikeSellIntent(text) && (forwardedAny || looksLikeBuyerListingLookup(text));
    const agentMedia = treatAsLookup ? {} : media;
    let spoken: string;
    if (treatAsLookup) {
      spoken = forwardedAny
        ? [
            "حوّلت إعلان موجود — تحقق هل هو منشور/موجود ولا انباع. لا تنشئ مسودة ولا تطلب انشر.",
            text ? `نص الإعلان:\n${text}` : "ما فيه نص مع التحويل؛ ابحث إن قدرت.",
          ].join("\n")
        : text;
    } else {
      spoken =
        text ||
        (media.photoFileId ? "صورة" : media.videoFileId ? "فيديو" : media.voiceFileId ? "صوت" : "");
    }
    if (!spoken) {
      // never leave a private message silent (stickers, contacts, etc.)
      await ctx.reply(FALLBACK_PROMPT);
      return;
    }

    try {
      const reply = await deps.agent.reply({
        telegramId: String(ctx.from?.id ?? ""),
        text: spoken,
        storeId: deps.storeId,
        media: agentMedia,
      });
      await ctx.reply(reply.text, reply.pendingConfirm ? { reply_markup: agentConfirmKeyboard() } : undefined);
    } catch (error) {
      deps.logger.error({ err: error }, "agent reply failed");
      await ctx.reply("صار خطأ، حاول مرة ثانية أو تواصل مع المالك.");
    }
  });
}
