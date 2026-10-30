import { looksLikeOwnerAdmin, looksLikeSellIntent } from "../../agent/heuristic";
import { AppError } from "../../domain/errors";
import {
  detectInquiryCode,
  isForwardedMessage,
  parseForwardedChannel,
} from "../../domain/inquiry-detect";
import { parsePrice } from "../../domain/price";
import type { BotContext } from "../context";
import type { AppDeps } from "../deps";
import { texts } from "../texts";
import { agentConfirmKeyboard } from "../keyboards";
import type { Bot } from "grammy";

function parseInquiryCallback(data: string): { action: "ok" | "no"; id: string } | null {
  const match = data.match(/^iq:(ok|no):(.+)$/);
  if (!match) return null;
  return { action: match[1] as "ok" | "no", id: match[2] };
}

/** رقم سعر لوحده مثل 900 أو 900 ريال */
function looksLikeBarePrice(text: string): boolean {
  const t = text.trim();
  if (t.length > 24) return false;
  return parsePrice(t) !== null && /^\d{2,6}(?:\s*(?:ريال|ر\.?س|sar))?$/i.test(t.replace(/[.,]/g, ""));
}

export function registerInquiryHandlers(bot: Bot<BotContext>, deps: AppDeps) {
  bot.callbackQuery(/^iq:(ok|no):/, async (ctx) => {
    const parsed = parseInquiryCallback(ctx.callbackQuery.data ?? "");
    const sellerId = String(ctx.from.id);
    if (!parsed) {
      await ctx.answerCallbackQuery();
      return;
    }
    try {
      if (parsed.action === "ok") {
        // أجب فوراً لتقليل إعادة إرسال تيليجرام لنفس الضغط
        await ctx.answerCallbackQuery({ text: "اكتب آخر سعر" });
        // لا تكرر طلب السعر إذا نفس الاستفسار قيد الانتظار
        if (ctx.session.pendingSellerPriceInquiryId === parsed.id) {
          return;
        }
        await deps.inquiries.beginAvailable(parsed.id, sellerId);
        ctx.session.pendingSellerPriceInquiryId = parsed.id;
        return;
      }
      ctx.session.pendingSellerPriceInquiryId = undefined;
      await deps.inquiries.confirmSold(parsed.id, sellerId);
      await ctx.answerCallbackQuery({ text: "تم البيع" });
    } catch (error) {
      try {
        await ctx.answerCallbackQuery();
      } catch {
        // قد تكون الإجابة تمت
      }
      await ctx.reply(error instanceof AppError ? error.userMessage : texts.sellerInquiryGone);
    }
  });

  bot.on("message", async (ctx, next) => {
    if (ctx.chat.type !== "private") {
      await next();
      return;
    }
    if (ctx.conversation.active("createListing") > 0 || ctx.conversation.active("setupStore") > 0) {
      await next();
      return;
    }

    if (!ctx.from) {
      await next();
      return;
    }

    const text = ctx.message.text?.trim();
    if (text && /^\/cancel(?:@\w+)?$/i.test(text) && ctx.session.pendingSellerPriceInquiryId) {
      ctx.session.pendingSellerPriceInquiryId = undefined;
      await ctx.reply(texts.cancelled);
      return;
    }

    if (ctx.session.pendingSellerPriceInquiryId && text && looksLikeOwnerAdmin(text)) {
      ctx.session.pendingSellerPriceInquiryId = undefined;
      await next();
      return;
    }

    if (ctx.session.pendingSellerPriceInquiryId && text && !text.startsWith("/")) {
      const price = parsePrice(text);
      if (price === null) {
        await ctx.reply(texts.sellerNeedPrice);
        return;
      }
      const inquiryId = ctx.session.pendingSellerPriceInquiryId;
      ctx.session.pendingSellerPriceInquiryId = undefined;
      try {
        await deps.inquiries.confirmAvailable(inquiryId, String(ctx.from.id), price);
      } catch (error) {
        await ctx.reply(error instanceof AppError ? error.userMessage : texts.sellerInquiryGone);
      }
      return;
    }

    // إذا ضاعت جلسة pending وكان الرسالة رقم سعر فقط — أكمل أحدث استفسار انتظار
    if (text && !text.startsWith("/") && looksLikeBarePrice(text)) {
      const price = parsePrice(text);
      if (price !== null) {
        try {
          await deps.inquiries.confirmAvailableLatest(String(ctx.from.id), price, deps.storeId);
          return;
        } catch {
          // مو بائع أو ما في استفسار — كمّل لباقي المعالجات
        }
      }
    }

    if (text?.startsWith("/")) {
      await next();
      return;
    }

    const forwarded = ctx.message ? parseForwardedChannel(ctx.message) : null;
    if (forwarded) {
      const captionOrText = (ctx.message.text ?? ctx.message.caption ?? "").trim();
      const code = detectInquiryCode(captionOrText);
      const telegramId = String(ctx.from.id);
      try {
        let focusShortCode: string | undefined;
        try {
          const listing = await deps.inquiries.resolveListing({
            buyerTelegramId: telegramId,
            shortCode: code ?? undefined,
            channelId: forwarded.channelId,
            channelMessageId: forwarded.messageId,
            storeId: deps.storeId,
          });
          if (listing?.shortCode) {
            focusShortCode = listing.shortCode;
            await deps.agent.memory.setFocus(deps.storeId, telegramId, listing.shortCode);
          }
        } catch {
          // إعلان مو مربوط بهالمتجر / مو موجود — الوكيل يجاوب بدون فوكس
        }

        // التحويل وحده → الوكيل يفهم الإعلان ويجاوب (استفسار التوفر يبقى برسالة لاحقة عبر الوكيل)
        const spoken = focusShortCode
          ? [
              `حوّلت إعلان من قناة المتجر رقمه ${focusShortCode}.`,
              captionOrText ? `نص الإعلان:\n${captionOrText}` : "جاوبني عن تفاصيله من بيانات المتجر.",
            ].join("\n")
          : captionOrText
            ? `حوّلت رسالة من قناة:\n${captionOrText}`
            : "حوّلت إعلان من القناة؛ ما قدرت أربطه برقم عندنا. وش تبي عنه؟";

        const reply = await deps.agent.reply({
          telegramId,
          text: spoken,
          storeId: deps.storeId,
          focusShortCode: focusShortCode ?? null,
        });
        await ctx.reply(reply.text, reply.pendingConfirm ? { reply_markup: agentConfirmKeyboard() } : undefined);
      } catch (error) {
        deps.logger.error({ err: error }, "forwarded channel agent failed");
        await ctx.reply("صار خطأ، حاول مرة ثانية أو تواصل مع المالك.");
      }
      return;
    }

    // تحويل من البوت/محادثة خاصة (مو قناة) أو لصق وصف إعلان = تحقق، مو نشر
    const captionOrText = (ctx.message?.text ?? ctx.message?.caption ?? "").trim();
    const forwardedAny = Boolean(ctx.message && isForwardedMessage(ctx.message));
    if (
      forwardedAny &&
      !looksLikeSellIntent(captionOrText)
    ) {
      const telegramId = String(ctx.from.id);
      const spoken = [
        "حوّلت إعلان موجود — تحقق هل هو منشور/موجود ولا انباع. لا تنشئ مسودة ولا تطلب انشر.",
        captionOrText ? `نص الإعلان:\n${captionOrText}` : "ما فيه نص مع التحويل.",
      ].join("\n");
      try {
        const reply = await deps.agent.reply({
          telegramId,
          text: spoken,
          storeId: deps.storeId,
          media: {},
        });
        await ctx.reply(reply.text, reply.pendingConfirm ? { reply_markup: agentConfirmKeyboard() } : undefined);
      } catch (error) {
        deps.logger.error({ err: error }, "forwarded non-channel agent failed");
        await ctx.reply("صار خطأ، حاول مرة ثانية أو تواصل مع المالك.");
      }
      return;
    }

    await next();
  });
}

export function shouldSkipListingVideo(ctx: BotContext): boolean {
  return Boolean(ctx.message && isForwardedMessage(ctx.message));
}
