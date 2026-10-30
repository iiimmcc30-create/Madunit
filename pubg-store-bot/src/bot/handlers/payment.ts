import { AppError } from "../../domain/errors";
import { submitSubscriptionReceipt } from "../../services/subscription";
import { subscriptionReviewKeyboard } from "../keyboards";
import type { BotContext } from "../context";
import type { AppDeps } from "../deps";
import { texts } from "../texts";
import type { Bot } from "grammy";

export function registerPaymentHandlers(bot: Bot<BotContext>, deps: AppDeps) {
  bot.callbackQuery(/^pay:(ok|no):/, async (ctx) => {
    const match = ctx.callbackQuery.data?.match(/^pay:(ok|no):(.+)$/);
    if (!match) {
      await ctx.answerCallbackQuery();
      return;
    }
    const [, action, paymentId] = match;
    const ownerId = String(ctx.from.id);
    try {
      if (action === "ok") {
        const listing = await deps.payments.confirm(paymentId, ownerId);
        await ctx.answerCallbackQuery({ text: "نُشر" });
        await ctx.reply(texts.published(listing.shortCode));
        return;
      }
      await deps.payments.reject(paymentId, ownerId);
      await ctx.answerCallbackQuery({ text: "مرفوض" });
      await ctx.reply(texts.paymentRejected);
    } catch (error) {
      await ctx.answerCallbackQuery();
      await ctx.reply(error instanceof AppError ? error.userMessage : "صار خطأ، حاول مرة ثانية.");
    }
  });

  bot.on("message:photo", async (ctx, next) => {
    if (ctx.chat.type !== "private") {
      await next();
      return;
    }
    if (ctx.conversation.active("createListing") > 0 || ctx.conversation.active("registerScrim") > 0 || ctx.conversation.active("openScrim") > 0) {
      await next();
      return;
    }
    if (ctx.session.pendingScrimSetting) {
      await next();
      return;
    }
    if (!ctx.from) {
      await next();
      return;
    }
    if (ctx.session.pendingSubscriptionReceipt) {
      const photo = ctx.message.photo.at(-1);
      if (!photo) {
        await next();
        return;
      }
      try {
        const payment = await submitSubscriptionReceipt(deps.db, {
          storeId: deps.storeId,
          payerTelegramId: String(ctx.from.id),
          photoFileId: photo.file_id,
          amount: deps.config.SUBSCRIPTION_PRICE_SAR,
          periodDays: deps.config.SUBSCRIPTION_DAYS,
        });
        ctx.session.pendingSubscriptionReceipt = undefined;
        const store = await deps.stores.getById(deps.storeId);
        await ctx.api.sendPhoto(deps.config.superAdminTelegramId, photo.file_id, {
          caption: `إيصال اشتراك\nالمتجر: ${store.title}\nالبوت: @${store.botUsername}\nالمبلغ: ${deps.config.SUBSCRIPTION_PRICE_SAR} ريال`,
          reply_markup: subscriptionReviewKeyboard(payment.id),
        });
        await ctx.reply(texts.subscriptionReceiptSent);
      } catch (error) {
        await ctx.reply(error instanceof AppError ? error.userMessage : texts.needReceipt);
      }
      return;
    }

    const listingId =
      ctx.session.pendingReceiptListingId ??
      (await deps.payments.findPendingListingId(String(ctx.from.id), deps.storeId));
    if (!listingId) {
      await next();
      return;
    }
    const photo = ctx.message.photo.at(-1);
    if (!photo) {
      await next();
      return;
    }
    try {
      await deps.payments.submitReceipt({
        listingId,
        sellerTelegramId: String(ctx.from.id),
        photoFileId: photo.file_id,
      });
      ctx.session.pendingReceiptListingId = undefined;
    } catch (error) {
      await ctx.reply(error instanceof AppError ? error.userMessage : texts.needReceipt);
    }
  });
}
