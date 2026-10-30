import type { Bot } from "grammy";
import { looksLikeOwnerAdmin } from "../../agent/heuristic";
import { isSuperAdmin } from "../../config";
import { AppError } from "../../domain/errors";
import {
  formatStopDateRiyadh,
  needsActivationDays,
} from "../../domain/subscription";
import {
  confirmSubscriptionPayment,
  expectedMonthlyRevenue,
  listPendingSubscriptionPayments,
  rejectSubscriptionPayment,
} from "../../services/subscription";
import { unbindStoreChannel } from "../../services/platform";
import type { StoreView } from "../../services/store";
import {
  adminConfirmKeyboard,
  adminHomeKeyboard,
  adminStoreKeyboard,
  subscriptionReviewKeyboard,
} from "../keyboards";
import type { BotContext } from "../context";
import type { AppDeps } from "../deps";
import { texts } from "../texts";

export const BOT_TOKEN_RE = /^\d{5,}:[A-Za-z0-9_-]{20,}$/;

function actor(ctx: BotContext) {
  return String(ctx.from?.id ?? "");
}

function untilLabel(store: Pick<StoreView, "subscriptionExpiresAt">): string {
  return formatStopDateRiyadh(store.subscriptionExpiresAt);
}

export function storeCardText(store: StoreView): string {
  return (
    `${store.title}\n` +
    `بوت: @${store.botUsername || "—"} · ${store.runtimeStatus}\n` +
    `القناة/المجموعة: ${store.channelId || "غير مربوط"}\n` +
    `${store.subscriptionLabel}`
  );
}

/** Platform overview + one card per store with management buttons. */
export async function sendStoresOverview(
  ctx: BotContext,
  deps: AppDeps,
  opts: { cards?: StoreView[]; note?: string } = {},
) {
  const stores = await deps.stores.list();
  const revenue = expectedMonthlyRevenue(stores, deps.config.SUBSCRIPTION_PRICE_SAR);
  const lines = stores.map(
    (store) =>
      `@${store.botUsername || "—"} · ${store.botEnabled ? "🟢" : "⛔"} ${store.runtimeStatus} · ${store.channelId || "غير مربوط"} · ${store.ownerUsername || "بدون مالك"}`,
  );
  await ctx.reply(
    `لوحة المنصة\nعدد المتاجر: ${stores.length}\nمتاجر نشطة/تجربة: ${revenue.activeStores}\nدخل شهري متوقع: ${revenue.expectedMonthly} ريال\n\n${lines.join("\n") || "ما فيه متاجر."}${opts.note ? `\n\n${opts.note}` : ""}`,
    { reply_markup: adminHomeKeyboard() },
  );
  for (const store of (opts.cards ?? stores).slice(0, 8)) {
    await ctx.reply(storeCardText(store), { reply_markup: adminStoreKeyboard(store.id) });
  }
}

export async function sendPendingPayments(ctx: BotContext, deps: AppDeps) {
  const rows = await listPendingSubscriptionPayments(deps.db);
  if (rows.length === 0) {
    await ctx.reply("ما فيه إيصالات اشتراك معلّقة.");
    return;
  }
  for (const row of rows) {
    await ctx.reply(
      `إيصال ${row.store.title || row.store.botUsername} — ${row.amount.toNumber()} ريال`,
      { reply_markup: subscriptionReviewKeyboard(row.id) },
    );
  }
}

export function registerAdminHandlers(bot: Bot<BotContext>, deps: AppDeps) {
  bot.command("admin", async (ctx) => {
    if (!isSuperAdmin(deps.config, actor(ctx))) {
      await ctx.reply(texts.adminOnly);
      return;
    }
    await sendStoresOverview(ctx, deps);
  });

  bot.callbackQuery("ad:nop", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "تمام، لغيت." });
  });

  bot.callbackQuery(/^ad:(unb|unbok|scrim):/, async (ctx) => {
    if (!isSuperAdmin(deps.config, actor(ctx))) {
      await ctx.answerCallbackQuery();
      return;
    }
    const match = ctx.callbackQuery.data.match(/^ad:(unb|unbok|scrim):(.+)$/);
    await ctx.answerCallbackQuery();
    if (!match) return;
    const [, action, storeId] = match;
    try {
      const store = await deps.stores.getById(storeId);
      if (action === "unb") {
        if (!store.channelId) {
          await ctx.reply(`متجر ${store.title} ما عنده قناة أو مجموعة مربوطة.`);
          return;
        }
        await ctx.reply(
          `متأكد تفك ربط القناة/المجموعة ${store.channelId} عن @${store.botUsername || store.title}؟\nالإعلانات ما راح تنشر لين تنربط قناة أو مجموعة جديدة بـ /setup أو /bind.`,
          { reply_markup: adminConfirmKeyboard("unb", storeId) },
        );
        return;
      }
      if (action === "unbok") {
        await unbindStoreChannel(deps.db, { storeId, actorTelegramId: actor(ctx) });
        await ctx.reply(
          `انفك ربط القناة/المجموعة عن @${store.botUsername || store.title} ✅\nلربط جديد: صاحب المتجر يرسل /setup بالخاص أو /bind داخل المجموعة، في @${store.botUsername || "البوت"}.`,
        );
        return;
      }
      ctx.session.pendingAdminAction = { kind: "scrim_token", storeId };
      await ctx.reply(
        `أرسل توكن بوت السكرمات لمتجر @${store.botUsername || store.title} (بوت جديد من BotFather، مو بوت المتجر).\nرسالتك تنحذف تلقائي، أو /cancel.`,
      );
    } catch (error) {
      await ctx.reply(error instanceof AppError ? error.userMessage : "صار خطأ.");
    }
  });

  bot.callbackQuery("ad:add", async (ctx) => {
    if (!isSuperAdmin(deps.config, actor(ctx))) {
      await ctx.answerCallbackQuery();
      return;
    }
    ctx.session.pendingAdminAction = { kind: "add_token" };
    await ctx.answerCallbackQuery();
    await ctx.reply(texts.adminAskToken);
  });

  bot.callbackQuery("ad:pays", async (ctx) => {
    if (!isSuperAdmin(deps.config, actor(ctx))) {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    await sendPendingPayments(ctx, deps);
  });

  bot.callbackQuery(/^ad:(on|off|ext|del):/, async (ctx) => {
    if (!isSuperAdmin(deps.config, actor(ctx))) {
      await ctx.answerCallbackQuery();
      return;
    }
    const match = ctx.callbackQuery.data.match(/^ad:(on|off|ext|del):(.+)$/);
    if (!match) {
      await ctx.answerCallbackQuery();
      return;
    }
    const [, action, storeId] = match;
    try {
      if (action === "on") {
        const store = await deps.stores.getById(storeId);
        if (
          needsActivationDays({
            subscriptionStatus: store.subscriptionStatus,
            subscriptionExpiresAt: store.subscriptionExpiresAt,
          })
        ) {
          ctx.session.pendingAdminAction = { kind: "extend", storeId, alsoEnable: true };
          await ctx.answerCallbackQuery({ text: "حدّد أيام التفعيل" });
          await ctx.reply(texts.adminAskExtendDays);
          return;
        }
        await deps.platform.setEnabled(storeId, true, actor(ctx));
        await ctx.answerCallbackQuery({ text: "مفعّل" });
        return;
      }
      if (action === "off") {
        await deps.platform.setEnabled(storeId, false, actor(ctx));
        await ctx.answerCallbackQuery({ text: "موقوف" });
        return;
      }
      if (action === "del") {
        await deps.platform.remove(storeId, actor(ctx));
        await ctx.answerCallbackQuery({ text: "حُذف" });
        await ctx.reply("توقف البوت وانشال التوكن. البيانات محفوظة.");
        return;
      }
      ctx.session.pendingAdminAction = { kind: "extend", storeId };
      await ctx.answerCallbackQuery();
      await ctx.reply(texts.adminAskExtendDays);
    } catch (error) {
      await ctx.answerCallbackQuery();
      await ctx.reply(error instanceof AppError ? error.userMessage : "صار خطأ.");
    }
  });

  bot.callbackQuery(/^subpay:(ok|no):/, async (ctx) => {
    if (!isSuperAdmin(deps.config, actor(ctx))) {
      await ctx.answerCallbackQuery();
      return;
    }
    const match = ctx.callbackQuery.data.match(/^subpay:(ok|no):(.+)$/);
    if (!match) {
      await ctx.answerCallbackQuery();
      return;
    }
    try {
      if (match[1] === "ok") {
        const result = await confirmSubscriptionPayment(deps.db, {
          paymentId: match[2],
          actorTelegramId: actor(ctx),
        });
        await ctx.answerCallbackQuery({ text: "تم التمديد" });
        const until = untilLabel(result.store);
        await ctx.reply(texts.subscriptionConfirmed(until));
        try {
          await ctx.api.sendMessage(result.payment.payerTelegramId, texts.subscriptionConfirmed(until));
        } catch {
          // المالك قد يكون مغلق الخاص
        }
        return;
      }
      await rejectSubscriptionPayment(deps.db, {
        paymentId: match[2],
        actorTelegramId: actor(ctx),
      });
      await ctx.answerCallbackQuery({ text: "مرفوض" });
      await ctx.reply(texts.subscriptionRejected);
    } catch (error) {
      await ctx.answerCallbackQuery();
      await ctx.reply(error instanceof AppError ? error.userMessage : "صار خطأ.");
    }
  });

  bot.on("message:text", async (ctx, next) => {
    const pending = ctx.session.pendingAdminAction;
    if (!pending || ctx.chat.type !== "private" || !isSuperAdmin(deps.config, actor(ctx))) {
      await next();
      return;
    }
    const text = ctx.message.text.trim();
    if (text.startsWith("/") || looksLikeOwnerAdmin(text)) {
      if (looksLikeOwnerAdmin(text)) ctx.session.pendingAdminAction = undefined;
      await next();
      return;
    }
    try {
      if (pending.kind === "add_token" || pending.kind === "scrim_token") {
        ctx.session.pendingAdminAction = undefined;
        await ctx.deleteMessage().catch(() => undefined);
        if (!BOT_TOKEN_RE.test(text)) {
          ctx.session.pendingAdminAction = pending;
          await ctx.reply(texts.adminBadToken);
          return;
        }
        if (pending.kind === "scrim_token") {
          const username = await deps.platform.attachScrimBot(pending.storeId, text, actor(ctx));
          await ctx.reply(texts.scrimBotAttached(username));
          return;
        }
        await ctx.reply("لحظة، أتحقق من التوكن وأشغّل البوت…");
        const store = await deps.platform.addFromToken(text, actor(ctx));
        await ctx.reply(texts.adminStoreAdded(store.botUsername || store.title));
        ctx.session.pendingAdminAction = { kind: "extend", storeId: store.id, alsoEnable: true };
        await ctx.reply(texts.adminAskActivationDays);
        return;
      }
      const days = Number(text);
      if (!Number.isInteger(days) || days <= 0 || days > 365) {
        await ctx.reply(texts.adminAskExtendDays);
        return;
      }
      ctx.session.pendingAdminAction = undefined;
      const store = await deps.platform.extend(pending.storeId, days, actor(ctx));
      if (pending.alsoEnable) {
        await deps.platform.setEnabled(pending.storeId, true, actor(ctx));
      }
      const until = untilLabel(store);
      await ctx.reply(
        pending.alsoEnable
          ? `تم التفعيل ✅ لمدة ${days} يوم · يوقف يوم ${until}`
          : texts.subscriptionConfirmed(until),
      );
    } catch (error) {
      ctx.session.pendingAdminAction = undefined;
      await ctx.reply(error instanceof AppError ? error.userMessage : "صار خطأ.");
    }
  });
}
