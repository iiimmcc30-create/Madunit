import { looksLikeOwnerAdmin } from "../../agent/heuristic";
import { AppError } from "../../domain/errors";
import { parseListingFee } from "../../domain/fee";
import { parseGlossaryText } from "../../domain/glossary";
import { botDeepLink, storeStartPayload } from "../../domain/start-payload";
import { formatStoreStats, getStoreStats } from "../../services/stats";
import { isSuperAdmin } from "../../config";
import {
  isStoreOperator,
  updateStoreSettings,
  type StoreView,
} from "../../services/store";
import { unbindStoreChannel } from "../../services/platform";
import { InlineKeyboard, type Bot } from "grammy";
import type { BotContext, StoreSettingField } from "../context";
import type { AppDeps } from "../deps";
import { settingsKeyboard } from "../keyboards";
import { texts } from "../texts";

function ownerId(ctx: BotContext): string {
  return String(ctx.from?.id ?? "");
}

function formatSettings(store: StoreView): string {
  const glossaryLine = store.customGlossary.length
    ? store.customGlossary.map((entry) => entry.term).slice(0, 10).join("، ")
    : "اضغط «المعجم» لإضافة مصطلحات القناة";
  return texts.settingsCard(
    store.title,
    store.channelId ?? "—",
    store.ownerUsername,
    String(store.listingFee),
    store.publishMode,
    store.subscriptionLabel,
    store.paymentInstructions,
    glossaryLine,
  );
}

function inviteText(deps: AppDeps, store: StoreView): string | null {
  if (!deps.botUsername) return null;
  return texts.sellerInvite(botDeepLink(deps.botUsername, storeStartPayload(store.id)));
}

async function replySettings(ctx: BotContext, deps: AppDeps, store: StoreView) {
  await ctx.reply(formatSettings(store), {
    parse_mode: "HTML",
    reply_markup: settingsKeyboard(store.id),
  });
  const invite = inviteText(deps, store);
  if (invite) await ctx.reply(invite);
}

async function requireThisStoreOperator(deps: AppDeps, telegramId: string): Promise<StoreView | null> {
  const store = await deps.stores.getById(deps.storeId);
  if (!isStoreOperator(store, telegramId, deps.config.superAdminTelegramId)) return null;
  return store;
}

export function registerStoreHandlers(bot: Bot<BotContext>, deps: AppDeps) {
  const BIND_PHRASE =
    /(اربط القناة|أربط القناة|اربط المجموعة|أربط المجموعة|غيّر القناة|غير القناة|ربط القناة|ربط المجموعة|اربط قناة|أربط قناة)/i;
  const UNBIND_PHRASE = /(فك الربط|فك ربط|ألغ الربط|الغاء الربط|أفك الربط|افك الربط)/i;

  async function startBindFlow(ctx: BotContext) {
    const store = await deps.stores.getById(deps.storeId);
    const actor = ownerId(ctx);
    const allowed =
      isSuperAdmin(deps.config, actor) || !store.ownerTelegramId || store.ownerTelegramId === actor;
    if (!allowed) {
      await ctx.reply(texts.notOwner);
      return;
    }
    await ctx.conversation.enter("setupStore");
  }

  async function askUnbind(ctx: BotContext) {
    const store = await requireThisStoreOperator(deps, ownerId(ctx));
    if (!store) {
      await ctx.reply(texts.notOwner);
      return;
    }
    if (!store.channelId) {
      await ctx.reply(texts.storeUnbindNone);
      return;
    }
    ctx.session.pendingUnbindConfirm = true;
    const kb = new InlineKeyboard()
      .text("نعم، فك الربط", "st:unbind:yes")
      .text("لا", "st:unbind:no");
    await ctx.reply(texts.storeUnbindConfirm(store.channelId), { reply_markup: kb });
  }

  bot.command("setup", async (ctx) => {
    await startBindFlow(ctx);
  });

  bot.callbackQuery(/^st:bind:/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await startBindFlow(ctx);
  });

  bot.callbackQuery(/^st:unbind:(yes|no)$/, async (ctx) => {
    const which = ctx.callbackQuery.data.endsWith("yes") ? "yes" : "no";
    await ctx.answerCallbackQuery();
    if (which === "no") {
      ctx.session.pendingUnbindConfirm = undefined;
      await ctx.reply(texts.storeUnbindCancelled);
      return;
    }
    try {
      await unbindStoreChannel(deps.db, {
        storeId: deps.storeId,
        actorTelegramId: ownerId(ctx),
      });
      ctx.session.pendingUnbindConfirm = undefined;
      await ctx.reply(texts.storeUnbindDone);
    } catch (error) {
      await ctx.reply(error instanceof AppError ? error.userMessage : "صار خطأ، حاول مرة ثانية.");
    }
  });

  bot.callbackQuery(/^st:unbind:/, async (ctx) => {
    // زر الإعدادات: اطلب تأكيد
    await ctx.answerCallbackQuery();
    await askUnbind(ctx);
  });

  bot.command("settings", async (ctx) => {
    const store = await requireThisStoreOperator(deps, ownerId(ctx));
    if (!store) {
      await ctx.reply(texts.notOwner);
      return;
    }
    await replySettings(ctx, deps, store);
  });

  bot.command("stats", async (ctx) => {
    const store = await requireThisStoreOperator(deps, ownerId(ctx));
    if (!store) {
      await ctx.reply(texts.notOwner);
      return;
    }
    const stats = await getStoreStats(deps.db, store.id);
    await ctx.reply(formatStoreStats(stats));
  });

  bot.callbackQuery(/^st:renew:/, async (ctx) => {
    const store = await requireThisStoreOperator(deps, ownerId(ctx));
    if (!store) {
      await ctx.answerCallbackQuery();
      await ctx.reply(texts.notOwner);
      return;
    }
    ctx.session.pendingSubscriptionReceipt = true;
    await ctx.answerCallbackQuery();
    await ctx.reply(
      texts.renewAskReceipt(
        String(deps.config.SUBSCRIPTION_PRICE_SAR),
        deps.config.SUBSCRIPTION_PAYMENT_INSTRUCTIONS,
      ),
    );
  });

  bot.callbackQuery(/^st:open:/, async (ctx) => {
    const storeId = ctx.callbackQuery.data.replace("st:open:", "");
    if (storeId !== deps.storeId) {
      await ctx.answerCallbackQuery();
      return;
    }
    try {
      const store = await deps.stores.getById(storeId);
      await ctx.answerCallbackQuery();
      await replySettings(ctx, deps, store);
    } catch (error) {
      await ctx.answerCallbackQuery();
      await ctx.reply(error instanceof AppError ? error.userMessage : texts.notOwner);
    }
  });

  bot.callbackQuery(/^st:stats:/, async (ctx) => {
    const storeId = ctx.callbackQuery.data.replace("st:stats:", "");
    try {
      const stats = await getStoreStats(deps.db, storeId);
      await ctx.answerCallbackQuery();
      await ctx.reply(formatStoreStats(stats));
    } catch (error) {
      await ctx.answerCallbackQuery();
      await ctx.reply(error instanceof AppError ? error.userMessage : texts.notOwner);
    }
  });

  bot.callbackQuery(/^st:mode:/, async (ctx) => {
    const match = ctx.callbackQuery.data.match(/^st:mode:([^:]+):(AUTO|APPROVAL)$/);
    if (!match) {
      await ctx.answerCallbackQuery();
      return;
    }
    try {
      const store = await updateStoreSettings(deps.db, {
        storeId: match[1],
        actorTelegramId: ownerId(ctx),
        envOwnerId: deps.config.superAdminTelegramId,
        publishMode: match[2] as "AUTO" | "APPROVAL",
      });
      await ctx.answerCallbackQuery({ text: "تم" });
      await replySettings(ctx, deps, store);
    } catch (error) {
      await ctx.answerCallbackQuery();
      await ctx.reply(error instanceof AppError ? error.userMessage : texts.notOwner);
    }
  });

  bot.callbackQuery(/^st:(fee|user|title|ins|gloss):/, async (ctx) => {
    const match = ctx.callbackQuery.data.match(/^st:(fee|user|title|ins|gloss):(.+)$/);
    if (!match) {
      await ctx.answerCallbackQuery();
      return;
    }
    const field: StoreSettingField =
      match[1] === "user"
        ? "username"
        : match[1] === "ins"
          ? "instructions"
          : match[1] === "gloss"
            ? "glossary"
            : (match[1] as StoreSettingField);
    ctx.session.pendingStoreSetting = { storeId: match[2], field };
    await ctx.answerCallbackQuery();
    const prompt =
      field === "fee"
        ? texts.settingsAskFee
        : field === "username"
          ? texts.settingsAskUsername
          : field === "title"
            ? texts.settingsAskTitle
            : field === "glossary"
              ? texts.settingsAskGlossary
              : texts.settingsAskInstructions;
    await ctx.reply(prompt);
  });

  bot.on("message:text", async (ctx, next) => {
    if (ctx.chat.type === "private" && ctx.from) {
      const spoken = ctx.message.text.trim();
      if (!spoken.startsWith("/") && (BIND_PHRASE.test(spoken) || UNBIND_PHRASE.test(spoken))) {
        const store = await requireThisStoreOperator(deps, ownerId(ctx));
        if (store) {
          if (UNBIND_PHRASE.test(spoken)) {
            await askUnbind(ctx);
            return;
          }
          await startBindFlow(ctx);
          return;
        }
      }
    }
    const pending = ctx.session.pendingStoreSetting;
    if (!pending || ctx.chat.type !== "private") {
      await next();
      return;
    }
    if (ctx.conversation.active("createListing") > 0 || ctx.conversation.active("setupStore") > 0) {
      await next();
      return;
    }
    const text = ctx.message.text.trim();
    if (text.startsWith("/") || looksLikeOwnerAdmin(text)) {
      if (looksLikeOwnerAdmin(text)) ctx.session.pendingStoreSetting = undefined;
      await next();
      return;
    }
    try {
      const patch: {
        title?: string;
        ownerUsername?: string;
        listingFee?: number;
        paymentInstructions?: string;
        customGlossary?: ReturnType<typeof parseGlossaryText>;
      } = {};
      if (pending.field === "fee") {
        const fee = parseListingFee(text);
        if (fee === null) {
          await ctx.reply(texts.setupNeedFee);
          return;
        }
        patch.listingFee = fee;
      } else if (pending.field === "username") {
        patch.ownerUsername = text;
      } else if (pending.field === "title") {
        patch.title = text;
      } else if (pending.field === "glossary") {
        const entries = parseGlossaryText(text);
        if (entries.length === 0) {
          await ctx.reply(texts.settingsAskGlossary);
          return;
        }
        patch.customGlossary = entries;
      } else {
        patch.paymentInstructions = text;
      }
      const store = await updateStoreSettings(deps.db, {
        storeId: pending.storeId,
        actorTelegramId: ownerId(ctx),
        envOwnerId: deps.config.superAdminTelegramId,
        ...patch,
      });
      ctx.session.pendingStoreSetting = undefined;
      await ctx.reply(texts.settingsSaved);
      await replySettings(ctx, deps, store);
    } catch (error) {
      await ctx.reply(error instanceof AppError ? error.userMessage : "صار خطأ، حاول مرة ثانية.");
    }
  });
}
