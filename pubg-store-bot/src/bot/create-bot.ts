import { RedisAdapter } from "@grammyjs/storage-redis";
import { conversations, createConversation } from "@grammyjs/conversations";
import { Bot, session } from "grammy";
import type Redis from "ioredis";
import type { AppConfig } from "../config";
import { isSuperAdmin } from "../config";
import { AppError } from "../domain/errors";
import { parseOwnerCommandPayload, parseSyncChannelPayload } from "../domain/short-code";
import { importChannelListings, importForwardedChannelPost } from "../services/channel-sync";
import { parseForwardedChannel } from "../domain/inquiry-detect";
import {
  botDeepLink,
  parseStartPayload,
  storeStartPayload,
} from "../domain/start-payload";
import { redactTelegramError } from "../infra/token-cipher";
import { bindSellerToStore } from "../services/seller";
import { trackReferral } from "../services/referral";
import { makeOpenScrimConversation } from "./conversations/open-scrim";
import { makeRegisterScrimConversation } from "./conversations/register-scrim";
import { makeSetupStoreConversation } from "./conversations/setup-store";
import type { BotContext, SessionData } from "./context";
import type { AppDeps } from "./deps";
import { createRateLimitMiddleware } from "../infra/rate-limit";
import { createSubscriptionGate } from "./middleware/subscription-gate";
import { registerAdminHandlers } from "./handlers/admin";
import { registerIntentHandlers } from "./handlers/intent";
import { registerInquiryHandlers } from "./handlers/inquiry";
import { shouldClaimOwnerByUsername } from "../domain/owner-claim";
import { registerOwnerSoldHandlers } from "./handlers/owner-sold";
import { registerModerationHandlers } from "./handlers/moderation";
import { registerPaymentHandlers } from "./handlers/payment";
import { registerScrimHandlers } from "./handlers/scrim";
import { registerScrimSettingsHandlers } from "./handlers/scrim-settings";
import { registerScrimGroupHandlers } from "./handlers/scrim-review";
import { registerScrimDropsHandlers } from "./handlers/scrim-timers";
import { registerStoreHandlers } from "./handlers/store";
import { registerPlatformCommands, registerPlatformText } from "./handlers/platform";
import { registerGroupBindHandlers } from "./handlers/group-bind";
import { registerTradersMirrorHandlers } from "./handlers/traders-mirror";
import { downloadTelegramFile } from "../infra/telegram-file";
import { createUpdateDedupeMiddleware } from "../infra/update-dedupe";
import { resolveActorRole } from "../agent/roles";
import { isPrivateAgentDisabled } from "../domain/private-agent";
import { formatStoreStats, getStoreStats } from "../services/stats";
import { agentConfirmKeyboard, ownerStartKeyboard, startKeyboard } from "./keyboards";
import { texts } from "./texts";

export function createBotShell(input: {
  token: string;
  storeId: string;
  config: AppConfig;
  redis: Redis;
  /** Separates Redis keys (sessions, dedupe, conversations) for a store's second bot. */
  keyId?: string;
}) {
  const bot = new Bot<BotContext>(input.token);
  const keyId = input.keyId ?? input.storeId;
  const sessionStorage = new RedisAdapter<SessionData>({ instance: input.redis as never });

  if (process.env.BOT_DEBUG_UPDATES === "1") {
    bot.use(async (ctx, next) => {
      const started = Date.now();
      console.log(JSON.stringify({ msg: "update in", keyId, updateId: ctx.update.update_id, from: ctx.from?.id, chat: ctx.chat?.type, text: ctx.message?.text?.slice(0, 40) }));
      try {
        await next();
      } finally {
        console.log(JSON.stringify({ msg: "update done", keyId, updateId: ctx.update.update_id, ms: Date.now() - started }));
      }
    });
  }
  bot.use(createUpdateDedupeMiddleware(input.redis, keyId));

  bot.use(
    session({
      initial: (): SessionData => ({ homeStoreId: input.storeId }),
      storage: sessionStorage,
      getSessionKey: (ctx) =>
        ctx.chat?.id !== undefined ? `psb:session:${keyId}:${ctx.chat.id}` : undefined,
    }),
  );

  bot.use(
    createRateLimitMiddleware(input.redis, {
      windowSeconds: input.config.RATE_LIMIT_WINDOW_SECONDS,
      max: input.config.RATE_LIMIT_MAX,
      ownerTelegramId: input.config.superAdminTelegramId,
    }),
  );

  bot.use(
    conversations({
      storage: {
        type: "key",
        prefix: `psb:convo:${keyId}:`,
        version: 3,
        adapter: new RedisAdapter({ instance: input.redis as never }),
      },
    }),
  );

  return bot;
}

/**
 * market: listings/ads/stores/inquiries/payments only (the store also has a scrims bot).
 * scrims: scrim commands, registration, groups, reminders, results only.
 * both: everything on one bot (store without a scrims bot; backward compatible).
 */
export type BotRole = "market" | "scrims" | "both";

export const SCRIM_BOT_COMMANDS = [
  { command: "scrim", description: "فتح سكرم جديد" },
  { command: "scrim_list", description: "لستة الفرق" },
  { command: "scrim_lock", description: "قفل التسجيل" },
  { command: "scrim_add", description: "إضافة فريق يدوي" },
  { command: "scrim_remove", description: "شطب فريق" },
  { command: "scrim_maps", description: "خرائط الرومات" },
  { command: "scrim_done", description: "ختام السكرم" },
  { command: "scrim_settings", description: "إعدادات وقوالب السكرم" },
  { command: "scrim_schedule", description: "السكرم المجدول" },
  { command: "scrim_group", description: "ربط قروب المنظمين (داخل القروب)" },
  { command: "scrim_drops_group", description: "ربط قروب النزلات (داخل القروب)" },
  { command: "cancel", description: "إلغاء" },
];

export function registerBot(bot: Bot<BotContext>, deps: Omit<AppDeps, "downloadTelegramFile">, botRole: BotRole = "both") {
  const full: AppDeps = {
    ...deps,
    downloadTelegramFile: (fileId, asDataUrl) => downloadTelegramFile(bot, fileId, asDataUrl),
  };
  deps = full;
  // sarhstoree: شطب المالك أول شي (قبل أي محادثة ربط/إعداد معلقة)
  if (botRole !== "scrims" && !deps.isPlatformBot) registerOwnerSoldHandlers(bot, full);
  bot.use(createConversation(makeSetupStoreConversation(full), "setupStore"));
  bot.use(createConversation(makeOpenScrimConversation(full), "openScrim"));
  bot.use(createConversation(makeRegisterScrimConversation(full), "registerScrim"));
  bot.use(createSubscriptionGate(full));

  bot.catch((error) => {
    deps.logger.error({ err: redactTelegramError(error.error) }, "bot error");
  });

  bot.command("cancel", async (ctx) => {
    const receiptListingId = ctx.session.pendingReceiptListingId;
    ctx.session.pendingSellerPriceInquiryId = undefined;
    ctx.session.pendingUnbindConfirm = undefined;
    ctx.session.pendingReceiptListingId = undefined;
    ctx.session.pendingStoreSetting = undefined;
    ctx.session.pendingSubscriptionReceipt = undefined;
    ctx.session.pendingAdminAction = undefined;
    ctx.session.pendingScrimSetting = undefined;
    ctx.session.pendingScrimRosterEdit = undefined;
    ctx.session.pendingScrimAddTeam = undefined;
    ctx.session.pendingScrimRemoveTeam = undefined;
    ctx.session.pendingScrimResultEdit = undefined;
    await ctx.conversation.exitAll();
    if (receiptListingId) {
      try {
        await deps.listings.cancel(receiptListingId, String(ctx.from?.id ?? ""));
      } catch {
        // الإعلان قد يكون ملغيًا أو نُشر
      }
    }
    await ctx.reply(texts.cancelled);
  });

  bot.command("reset", async (ctx) => {
    ctx.session.pendingSellerPriceInquiryId = undefined;
    ctx.session.pendingUnbindConfirm = undefined;
    ctx.session.pendingReceiptListingId = undefined;
    ctx.session.pendingStoreSetting = undefined;
    ctx.session.pendingSubscriptionReceipt = undefined;
    ctx.session.pendingAdminAction = undefined;
    ctx.session.pendingScrimSetting = undefined;
    ctx.session.pendingScrimRosterEdit = undefined;
    ctx.session.pendingScrimAddTeam = undefined;
    ctx.session.pendingScrimRemoveTeam = undefined;
    ctx.session.pendingScrimResultEdit = undefined;
    await ctx.conversation.exitAll();
    await deps.agent.memory.reset(deps.storeId, String(ctx.from?.id ?? ""));
    await ctx.reply("مسحت حالة المحادثة. تقدر تبدأ من جديد.");
  });

  // /bind inside a group, and basic-group -> supergroup migration (market and scrims bots)
  if (!deps.isPlatformBot) registerGroupBindHandlers(bot, full);

  // traders-group → channel mirror (allowlisted bots; handler self-gates)
  if (!deps.isPlatformBot && botRole !== "scrims") registerTradersMirrorHandlers(bot, full);

  // main/platform bot: management only, no listing flow
  if (deps.isPlatformBot && botRole !== "scrims") registerPlatformCommands(bot, full);

  bot.command("help", async (ctx) => {
    await ctx.reply(texts.help);
  });

  bot.command("start", async (ctx) => {
    await ctx.conversation.exitAll();
    const telegramId = String(ctx.from?.id ?? "");
    ctx.session.homeStoreId = deps.storeId;
    const payload = parseStartPayload(typeof ctx.match === "string" ? ctx.match : "");

    if (payload.kind === "scrim") {
      await ctx.conversation.enter("registerScrim", { scrimId: payload.scrimId });
      return;
    }
    if (botRole === "scrims") {
      await ctx.reply(texts.scrimBotWelcome);
      return;
    }

    if (payload.kind === "ask") {
      try {
        await deps.inquiries.openFromBuyer({
          buyerTelegramId: telegramId,
          shortCode: payload.shortCode,
          storeId: deps.storeId,
        });
      } catch (error) {
        deps.logger.error({ err: error }, "start ask failed");
        await ctx.reply("صار خطأ، حاول مرة ثانية أو تواصل مع المالك.");
      }
      return;
    }

    let store = await deps.stores.getById(deps.storeId);
    // متجر بدون مالك مربوط: أول /start من نفس يوزر المالك المسجل يثبّت ownerTelegramId
    if (
      !String(store.ownerTelegramId ?? "").trim() &&
      shouldClaimOwnerByUsername(store.ownerUsername, ctx.from?.username)
    ) {
      await deps.db.store.update({ where: { id: store.id }, data: { ownerTelegramId: telegramId } });
      deps.logger.info({ storeId: store.id, telegramId }, "store owner claimed by username on /start");
      store = await deps.stores.getById(deps.storeId);
    }

    if (payload.kind === "store" && payload.storeId === deps.storeId) {
      try {
        if (telegramId !== store.ownerTelegramId) {
          await bindSellerToStore(deps.db, telegramId, store.id);
          await trackReferral(deps.db, {
            storeId: store.id,
            telegramId,
            role: "SELLER",
            source: storeStartPayload(store.id),
          });
        }
      } catch (error) {
        await ctx.reply(error instanceof AppError ? error.userMessage : texts.unknownStore);
        return;
      }
    }

    const seller = await deps.db.seller.findUnique({ where: { telegramId } });
    const role = resolveActorRole({
      telegramId,
      storeOwnerTelegramId: store.ownerTelegramId,
      superAdminTelegramId: deps.config.superAdminTelegramId,
      envOwnerTelegramId: deps.config.OWNER_TELEGRAM_ID,
      isSellerOnStore: seller?.homeStoreId === store.id,
    });
    deps.logger.info(
      {
        telegramId,
        role,
        storeId: store.id,
        storeOwnerTelegramId: store.ownerTelegramId || null,
        superAdminTelegramId: deps.config.superAdminTelegramId,
        envOwnerTelegramId: deps.config.OWNER_TELEGRAM_ID,
      },
      "actor role resolved",
    );
    if (role === "owner" || role === "super_admin" || isSuperAdmin(deps.config, telegramId)) {
      await ctx.reply(texts.ownerWelcome, { reply_markup: ownerStartKeyboard() });
      if (deps.botUsername) {
        await ctx.reply(texts.sellerInvite(botDeepLink(deps.botUsername, storeStartPayload(store.id))));
      }
      return;
    }
    await ctx.reply(texts.storeWelcome(store.title), { reply_markup: startKeyboard() });
  });

  bot.callbackQuery("start:list", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.exitAll();
    if (isPrivateAgentDisabled(deps.botUsername)) {
      await ctx.reply(texts.privateAgentOff);
      return;
    }
    try {
      const telegramId = String(ctx.from?.id ?? "");
      try {
        await bindSellerToStore(deps.db, telegramId, deps.storeId);
      } catch (error) {
        deps.logger.warn({ err: error }, "start:list bind seller failed");
      }
      const reply = await deps.agent.reply({
        telegramId,
        text: "أبي أبيع حساب",
        storeId: deps.storeId,
      });
      await ctx.reply(reply.text, reply.pendingConfirm ? { reply_markup: agentConfirmKeyboard() } : undefined);
    } catch (error) {
      deps.logger.error({ err: error }, "start list via agent failed");
      await ctx.reply("أرسل فيديو الحساب والوصف والسعر، أو اكتب «أبي أبيع».");
    }
  });

  bot.callbackQuery("start:no", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(texts.later);
  });

  bot.callbackQuery("start:stats", async (ctx) => {
    await ctx.answerCallbackQuery();
    const stats = await getStoreStats(deps.db, deps.storeId);
    await ctx.reply(formatStoreStats(stats));
  });

  bot.callbackQuery("start:settings", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply("للإعدادات اكتب /settings أو قل «غيّر الرسوم» أو «اربط القناة».");
  });

  if (botRole !== "scrims") registerMarketOwnerCommands(bot, deps);

  if (botRole !== "market") {
    registerScrimGroupHandlers(bot, full);
    registerScrimDropsHandlers(bot, full);
  }
  if (botRole !== "scrims") {
    registerAdminHandlers(bot, full);
    registerStoreHandlers(bot, full);
    registerModerationHandlers(bot, full);
  }
  if (botRole !== "market") registerScrimSettingsHandlers(bot, full);
  if (botRole !== "scrims") {
    registerPaymentHandlers(bot, full);
    registerInquiryHandlers(bot, full);
  }
  if (botRole !== "market") registerScrimHandlers(bot, full);
  if (botRole !== "scrims") {
    if (deps.isPlatformBot) registerPlatformText(bot, full);
    else registerIntentHandlers(bot, full);
  }

  return bot;
}

function registerMarketOwnerCommands(bot: Bot<BotContext>, deps: Omit<AppDeps, "downloadTelegramFile">) {
  bot.command("sold", async (ctx) => {
    const code = parseOwnerCommandPayload(ctx.match || ctx.message?.text || "");
    if (!code) {
      await ctx.reply(texts.needCode("sold"));
      return;
    }
    try {
      const listing = await deps.listings.markSold(code, String(ctx.from?.id ?? ""), deps.storeId);
      await deps.inquiries.notifyBuyersListingSold(listing.id);
      await ctx.reply(texts.soldOk(listing.shortCode));
    } catch (error) {
      await ctx.reply(error instanceof AppError ? error.userMessage : "صار خطأ، حاول مرة ثانية.");
    }
  });

  bot.command("delete", async (ctx) => {
    const code = parseOwnerCommandPayload(ctx.match || ctx.message?.text || "");
    if (!code) {
      await ctx.reply(texts.needCode("delete"));
      return;
    }
    try {
      const listing = await deps.listings.deleteListing(code, String(ctx.from?.id ?? ""), deps.storeId);
      await ctx.reply(texts.deletedOk(listing.shortCode));
    } catch (error) {
      await ctx.reply(error instanceof AppError ? error.userMessage : "صار خطأ، حاول مرة ثانية.");
    }
  });


  bot.command("sync_channel", async (ctx) => {
    const actor = String(ctx.from?.id ?? "");
    const store = await deps.stores.getById(deps.storeId);
    if (actor !== store.ownerTelegramId && !isSuperAdmin(deps.config, actor)) {
      await ctx.reply(texts.notOwner);
      return;
    }
    if (!store.channelId) {
      await ctx.reply(texts.syncChannelNoChannel);
      return;
    }
    const seedCode = parseSyncChannelPayload(ctx.match || ctx.message?.text || "");
    // If the command message is a forward from the store channel, import that one as seed
    const fwd = ctx.message ? parseForwardedChannel(ctx.message) : null;
    let seedMessageId: number | undefined;
    if (fwd && fwd.channelId === store.channelId && fwd.messageId > 0) {
      seedMessageId = fwd.messageId;
      try {
        const one = await importForwardedChannelPost(deps.db, deps.storeId, {
          channelId: fwd.channelId,
          messageId: fwd.messageId,
          caption: ctx.message?.caption ?? ctx.message?.text ?? "",
          photo: ctx.message?.photo,
          video: ctx.message?.video,
          animation: ctx.message?.animation,
          document: ctx.message?.document,
        });
        if (one) await ctx.reply(texts.syncChannelImportOne(one.shortCode, one.created));
      } catch (error) {
        deps.logger.error({ err: error, storeId: deps.storeId }, "sync_channel forward import failed");
      }
    }

    const scratchChatId = String(ctx.chat?.id ?? actor);
    await ctx.reply(seedCode ? texts.syncChannelSeedOk(seedCode) : texts.syncChannelStart);
    try {
      const result = await importChannelListings(deps.db, ctx.api, deps.storeId, {
        scratchChatId,
        seedCode,
        seedMessageId,
        onProgress: undefined,
      });
      if (result.error && result.imported === 0 && result.updated === 0) {
        await ctx.reply(texts.syncChannelFail(result.error));
        return;
      }
      await ctx.reply(texts.syncChannelOk(result));
    } catch (error) {
      deps.logger.error({ err: error, storeId: deps.storeId }, "sync_channel failed");
      await ctx.reply(
        texts.syncChannelFail(error instanceof AppError ? error.userMessage : "صار خطأ غير متوقع."),
      );
    }
  });

  bot.command("add_scrim_bot", async (ctx) => {
    const actor = String(ctx.from?.id ?? "");
    const store = await deps.stores.getById(deps.storeId);
    if (actor !== store.ownerTelegramId && !isSuperAdmin(deps.config, actor)) {
      await ctx.reply(texts.notOwner);
      return;
    }
    const token = (typeof ctx.match === "string" ? ctx.match : "").trim();
    // never leave a bot token sitting in the chat
    await ctx.deleteMessage().catch(() => undefined);
    if (!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token)) {
      await ctx.reply(texts.scrimBotUsage);
      return;
    }
    try {
      const username = await deps.platform.attachScrimBot(deps.storeId, token, actor);
      await ctx.reply(texts.scrimBotAttached(username));
    } catch (error) {
      await ctx.reply(error instanceof AppError ? error.userMessage : "ما قدرنا نربط بوت السكرمات.");
    }
  });

  bot.command("remove_scrim_bot", async (ctx) => {
    const actor = String(ctx.from?.id ?? "");
    const store = await deps.stores.getById(deps.storeId);
    if (actor !== store.ownerTelegramId && !isSuperAdmin(deps.config, actor)) {
      await ctx.reply(texts.notOwner);
      return;
    }
    await deps.platform.detachScrimBot(deps.storeId, actor);
    await ctx.reply(texts.scrimBotDetached);
  });
}
