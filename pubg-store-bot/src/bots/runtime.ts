import type { IncomingMessage, ServerResponse } from "node:http";
import type { PrismaClient } from "@prisma/client";
import { webhookCallback, type Bot } from "grammy";
import type Redis from "ioredis";
import { createStoreAgent, listingViewToPublic } from "../agent/create";
import { formatPublicListing } from "../agent/public-listing";
import { createBotShell, registerBot, SCRIM_BOT_COMMANDS } from "../bot/create-bot";
import type { BotContext } from "../bot/context";
import type { AppConfig } from "../config";
import { usesWebhook, webhookUrlForStore } from "../config";
import { AppError } from "../domain/errors";
import { createTelegramNotifier, type InquiryNotifier } from "../infra/notify";
import { createPaymentNotifier } from "../infra/payment-notify";
import { createTelegramPublisher, type ChannelPublisher } from "../infra/publisher";
import { redactTelegramError } from "../infra/token-cipher";
import type { InquiryJobs } from "../infra/queue";
import type { LlmProvider } from "../llm";
import type { Logger } from "../logger";
import { createPaymentProvider } from "../payments/provider";
import { findMatchingBuyerRequests } from "../services/buyer-request";
import { createInquiryService } from "../services/inquiry";
import { createListingService, type ListingService } from "../services/listing";
import { createPaymentService, type PaymentNotifier, type PaymentService } from "../services/payment";
import {
  addStoreFromToken,
  bootstrapLegacyStore,
  decryptStoreToken,
  detachStoreBot,
  rewrapStoreTokens,
  verifyBotToken,
} from "../services/platform";
import { createStoreService, toStoreView, type StoreService, type StoreView } from "../services/store";
import { extendStoreSubscription, setStoreEnabled } from "../services/subscription";
import type { BotController } from "./controller";
import { makeScrimTick } from "../bot/handlers/scrim-timers";
import { attachScrimBot, decryptScrimBotToken, detachScrimBot, migrateStoreChat, migratedChatId } from "../services/platform";
import type { AppDeps } from "../bot/deps";
import { acquirePollingLock, refreshPollingLock, releasePollingLock } from "../infra/update-dedupe";

type RunningBot = {
  storeId: string;
  bot: Bot<BotContext>;
  notifier: InquiryNotifier;
  publisher: ChannelPublisher;
  paymentNotifier: PaymentNotifier;
  username: string;
  pollHolder?: string;
  pollHeartbeat?: ReturnType<typeof setInterval>;
  handleWebhook?: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  scrimTick?: (now: Date) => Promise<void>;
};

export interface BotPlatform {
  controller: BotController;
  listings: ListingService;
  inquiries: ReturnType<typeof createInquiryService>;
  payments: PaymentService;
  stores: StoreService;
  agent: ReturnType<typeof createStoreAgent>;
  bootstrapLegacy(): Promise<StoreView>;
  startAll(): Promise<void>;
  stopAll(): Promise<void>;
  tickScrims(now: Date): Promise<void>;
}

function createChannelPublisherRouter(
  db: PrismaClient,
  bots: Map<string, RunningBot>,
): ChannelPublisher {
  const resolve = async (channelId: string) => {
    const store = await db.store.findUnique({ where: { channelId } });
    const running = store ? bots.get(store.id) : undefined;
    if (!running) {
      throw new AppError(
        "bot not running",
        "بوت هذا المتجر مو شغّال الحين.",
        "BOT_NOT_RUNNING",
      );
    }
    return running.publisher;
  };
  // a basic group that became a supergroup answers with migrate_to_chat_id: rebind and retry once
  const run = async <T>(channelId: string, op: (p: ChannelPublisher, chatId: string) => Promise<T>): Promise<T> => {
    const publisher = await resolve(channelId);
    try {
      return await op(publisher, channelId);
    } catch (error) {
      const moved = migratedChatId(error);
      if (!moved) throw error;
      await migrateStoreChat(db, channelId, moved);
      return op(publisher, moved);
    }
  };
  return {
    async sendVideo(channelId, fileId, caption) {
      return run(channelId, (p, id) => p.sendVideo(id, fileId, caption));
    },
    async sendListing(channelId, input) {
      return run(channelId, (p, id) => p.sendListing(id, input));
    },
    async editCaption(channelId, messageId, caption, replyMarkup) {
      return (await resolve(channelId)).editCaption(channelId, messageId, caption, replyMarkup);
    },
    async deleteMessage(channelId, messageId) {
      return (await resolve(channelId)).deleteMessage(channelId, messageId);
    },
  };
}

function createPaymentNotifierRouter(bots: Map<string, RunningBot>): PaymentNotifier {
  const pick = (storeId?: string) => {
    const running = storeId ? bots.get(storeId) : undefined;
    if (running) return running.paymentNotifier;
    const first = bots.values().next().value as RunningBot | undefined;
    if (!first) {
      throw new AppError("bot not running", "ما فيه بوت شغّال لإرسال الإيصال.", "BOT_NOT_RUNNING");
    }
    return first.paymentNotifier;
  };
  return {
    sendReceiptToOwner(input) {
      return pick(input.storeId).sendReceiptToOwner(input);
    },
    tellSellerReceiptReceived(sellerId, shortCode, storeId) {
      return pick(storeId).tellSellerReceiptReceived(sellerId, shortCode, storeId);
    },
    tellSellerPublished(sellerId, shortCode, storeId) {
      return pick(storeId).tellSellerPublished(sellerId, shortCode, storeId);
    },
    tellSellerRejected(sellerId, shortCode, storeId) {
      return pick(storeId).tellSellerRejected(sellerId, shortCode, storeId);
    },
  };
}

export function createBotPlatform(input: {
  config: AppConfig;
  db: PrismaClient;
  redis: Redis;
  llm: LlmProvider;
  logger: Logger;
  jobs: InquiryJobs;
}): BotPlatform {
  const bots = new Map<string, RunningBot>();
  /** Optional dedicated scrims bot per store (keyed by storeId). */
  const scrimBots = new Map<string, RunningBot>();
  const { config, db, redis, llm, logger, jobs } = input;

  let platform!: BotController;

  const listings = createListingService(db, createChannelPublisherRouter(db, bots), {
    dailyListingLimit: config.SELLER_DAILY_LISTING_LIMIT,
    getBotUsername: (storeId) => bots.get(storeId)?.username,
    onPublished: async (listing) => {
      const pub = listingViewToPublic(listing);
      const matched = await findMatchingBuyerRequests(db, pub);
      const notifier = bots.get(listing.storeId)?.notifier;
      if (!notifier) return;
      for (const request of matched) {
        try {
          await notifier.tellBuyerListingMatch(
            request.buyerTelegramId,
            listing.shortCode,
            listing.ownerUsername,
            formatPublicListing(pub),
          );
        } catch (error) {
          logger.warn({ err: redactTelegramError(error), buyer: request.buyerTelegramId }, "buyer match notify failed");
        }
      }
    },
  });

  const inquiries = createInquiryService(
    db,
    listings,
    (storeId) => {
      const running = bots.get(storeId);
      if (!running) {
        throw new AppError("bot not running", "بوت هذا المتجر مو شغّال الحين.", "BOT_NOT_RUNNING");
      }
      return running.notifier;
    },
    jobs,
  );

  const payments = createPaymentService(
    db,
    listings,
    createPaymentProvider(),
    createPaymentNotifierRouter(bots),
  );
  const stores = createStoreService(db, config);
  const agent = createStoreAgent({
    db,
    redis,
    llm,
    listings,
    inquiries,
    payments,
    logger,
    defaultChannelId: config.DEFAULT_CHANNEL_ID,
    superAdminTelegramId: config.superAdminTelegramId,
    envOwnerId: config.OWNER_TELEGRAM_ID,
    subscriptionPriceSar: config.SUBSCRIPTION_PRICE_SAR,
    subscriptionDays: config.SUBSCRIPTION_DAYS,
  });

  async function stopStore(storeId: string) {
    const running = bots.get(storeId);
    if (!running) return;
    if (running.pollHeartbeat) clearInterval(running.pollHeartbeat);
    if (running.pollHolder) {
      try {
        await releasePollingLock(redis, storeId, running.pollHolder);
      } catch (error) {
        logger.warn({ err: error, storeId }, "polling lock release failed");
      }
    }
    try {
      await running.bot.stop();
    } catch (error) {
      logger.warn({ err: redactTelegramError(error), storeId }, "bot stop failed");
    }
    bots.delete(storeId);
    await stopScrimBot(storeId);
  }

  async function stopScrimBot(storeId: string) {
    const running = scrimBots.get(storeId);
    if (!running) return;
    if (running.pollHeartbeat) clearInterval(running.pollHeartbeat);
    if (running.pollHolder) {
      await releasePollingLock(redis, `${storeId}:scrims`, running.pollHolder).catch(() => undefined);
    }
    try {
      await running.bot.stop();
    } catch (error) {
      logger.warn({ err: redactTelegramError(error), storeId }, "scrim bot stop failed");
    }
    scrimBots.delete(storeId);
  }

  async function startScrimBot(storeId: string, baseDeps: Omit<AppDeps, "downloadTelegramFile">) {
    await stopScrimBot(storeId);
    let token: string;
    try {
      token = (await decryptScrimBotToken(db, config, storeId)) ?? "";
    } catch (error) {
      logger.error({ err: redactTelegramError(error), storeId }, "scrim bot token decrypt failed");
      return;
    }
    if (!token) return;
    const keyId = `${storeId}:scrims`;
    const bot = createBotShell({ token, storeId, config, redis, keyId });
    try {
      await bot.init();
    } catch (error) {
      logger.error({ err: redactTelegramError(error), storeId }, "scrim bot getMe failed");
      return;
    }
    const username = (bot.botInfo.username ?? "").replace(/^@/, "");
    const running: RunningBot = {
      storeId,
      bot,
      notifier: createTelegramNotifier(bot.api),
      publisher: createTelegramPublisher(bot.api),
      paymentNotifier: createPaymentNotifier(bot.api),
      username,
    };
    const deps: Omit<AppDeps, "downloadTelegramFile"> = {
      ...baseDeps,
      botUsername: username,
      telegramFileUrl: async (fileId: string) => {
        try {
          const file = await bot.api.getFile(fileId);
          if (!file.file_path) return null;
          return `https://api.telegram.org/file/bot${token}/${file.file_path}`;
        } catch {
          return null;
        }
      },
    };
    registerBot(bot, deps, "scrims");
    running.scrimTick = makeScrimTick(bot.api, { ...deps, downloadTelegramFile: async () => null });
    scrimBots.set(storeId, running);
    await bot.api.setMyCommands(SCRIM_BOT_COMMANDS).catch(() => undefined);
    try {
      if (usesWebhook(config)) {
        running.handleWebhook = webhookCallback(bot, "http");
        await bot.api.setWebhook(webhookUrlForStore(config, String(bot.botInfo.id)), { drop_pending_updates: false });
        logger.info({ storeId, botUsername: username, role: "scrims" }, "scrim bot webhook set");
        return;
      }
      const pollHolder = `${process.pid}:${keyId}`;
      if (!(await acquirePollingLock(redis, keyId, pollHolder))) {
        logger.error({ storeId, pid: process.pid }, "skip scrim bot polling; another process owns it");
        scrimBots.delete(storeId);
        return;
      }
      running.pollHolder = pollHolder;
      running.pollHeartbeat = setInterval(() => {
        void refreshPollingLock(redis, keyId, pollHolder).then((ok) => {
          if (!ok) logger.error({ storeId }, "lost scrim bot polling lock");
        });
      }, 20000);
      await bot.api.deleteWebhook({ drop_pending_updates: true });
      void bot
        .start({
          drop_pending_updates: true,
          onStart: (info) => {
            logger.info({ storeId, username: info.username, id: info.id, pid: process.pid, role: "scrims" }, "scrim bot polling started");
          },
        })
        .catch((error) => {
          logger.error({ err: redactTelegramError(error), storeId }, "scrim bot polling failed");
        });
    } catch (error) {
      logger.error({ err: redactTelegramError(error), storeId }, "scrim bot transport failed");
    }
  }

  async function startStore(storeId: string) {
    await stopStore(storeId);
    const row = await db.store.findUnique({ where: { id: storeId } });
    if (!row?.tokenCipher) return;
    let token: string;
    try {
      token = (await decryptStoreToken(db, config, storeId)) ?? "";
    } catch (error) {
      logger.error({ err: redactTelegramError(error), storeId }, "store token decrypt failed");
      return;
    }
    if (!token) return;

    const bot = createBotShell({ token, storeId, config, redis });
    let username = row.botUsername;
    try {
      await bot.init();
      username = (bot.botInfo.username ?? row.botUsername).replace(/^@/, "");
      await db.store.update({
        where: { id: storeId },
        data: {
          botTelegramId: String(bot.botInfo.id),
          botUsername: username,
          botFirstName: bot.botInfo.first_name ?? row.botFirstName,
        },
      });
    } catch (error) {
      logger.error({ err: redactTelegramError(error), storeId }, "store bot getMe failed");
      return;
    }

    const running: RunningBot = {
      storeId,
      bot,
      notifier: createTelegramNotifier(bot.api),
      publisher: createTelegramPublisher(bot.api),
      paymentNotifier: createPaymentNotifier(bot.api),
      username,
    };

    if (usesWebhook(config) && row.webhookSecret) {
      running.handleWebhook = webhookCallback(bot, "http", { secretToken: row.webhookSecret });
    } else if (usesWebhook(config)) {
      running.handleWebhook = webhookCallback(bot, "http");
    }

    const botDeps: Omit<AppDeps, "downloadTelegramFile"> = {
      config,
      db,
      listings,
      inquiries,
      payments,
      stores,
      llm,
      agent,
      logger,
      botUsername: username,
      storeId,
      platform,
      isPlatformBot: String(bot.botInfo.id) === config.BOT_TOKEN.split(":")[0],
      telegramFileUrl: async (fileId) => {
        try {
          const file = await bot.api.getFile(fileId);
          if (!file.file_path) return null;
          return `https://api.telegram.org/file/bot${token}/${file.file_path}`;
        } catch {
          return null;
        }
      },
      redis,
    };
    const role = row.scrimBotTokenCipher ? "market" : "both";
    registerBot(bot, botDeps, role);
    running.scrimTick = makeScrimTick(bot.api, {
      ...botDeps,
      downloadTelegramFile: async () => null,
    });
    bots.set(storeId, running);
    if (row.scrimBotTokenCipher) {
      void startScrimBot(storeId, botDeps);
    }

    try {
      if (usesWebhook(config)) {
        await bot.api.setWebhook(webhookUrlForStore(config, storeId), {
          ...(row.webhookSecret ? { secret_token: row.webhookSecret } : {}),
          drop_pending_updates: false,
        });
        logger.info({ storeId, botUsername: username }, "store webhook set");
      } else {
        const pollHolder = `${process.pid}:${storeId}`;
        const gotLock = await acquirePollingLock(redis, storeId, pollHolder);
        if (!gotLock) {
          logger.error({ storeId, pid: process.pid }, "skip polling; another process already owns this bot");
          try {
            await bot.stop();
          } catch {
            // ignore
          }
          bots.delete(storeId);
          return;
        }
        running.pollHolder = pollHolder;
        running.pollHeartbeat = setInterval(() => {
          void refreshPollingLock(redis, storeId, pollHolder).then((ok) => {
            if (!ok) logger.error({ storeId }, "lost polling lock");
          });
        }, 20000);
        await bot.api.deleteWebhook({ drop_pending_updates: true });
        void bot
          .start({
            drop_pending_updates: true,
            onStart: (info) => {
              logger.info({ storeId, username: info.username, id: info.id, pid: process.pid }, "store bot polling started");
            },
          })
          .catch((error) => {
            logger.error({ err: redactTelegramError(error), storeId }, "store bot polling failed");
          });
      }
    } catch (error) {
      logger.error({ err: redactTelegramError(error), storeId }, "store bot transport failed");
    }
  }

  async function addFromToken(token: string, actorTelegramId: string) {
    const result = await addStoreFromToken(db, config, { token, actorTelegramId });
    await startStore(result.store.id);
    return result.store;
  }

  async function handleWebhook(botId: string, req: IncomingMessage, res: ServerResponse) {
    let running = bots.get(botId);
    if (!running) {
      const store = await db.store.findFirst({
        where: { OR: [{ id: botId }, { botTelegramId: botId }] },
      });
      if (store) running = bots.get(store.id);
    }
    if (!running) {
      const owner = await db.store.findFirst({ where: { scrimBotTelegramId: botId } });
      if (owner) running = scrimBots.get(owner.id);
    }
    if (!running?.handleWebhook) return false;
    await running.handleWebhook(req, res);
    return true;
  }

  async function sendStoreMessage(storeId: string, telegramId: string, text: string) {
    const running = bots.get(storeId);
    if (!running || !telegramId) return;
    try {
      await running.bot.api.sendMessage(telegramId, text);
    } catch (error) {
      logger.warn({ err: redactTelegramError(error), storeId }, "store owner notify failed");
    }
  }

  platform = {
    addFromToken,
    startStore,
    stopStore,
    async setEnabled(storeId, enabled, actorTelegramId) {
      const updated = await setStoreEnabled(db, { storeId, enabled, actorTelegramId });
      return toStoreView(updated);
    },
    async extend(storeId, days, actorTelegramId) {
      const updated = await extendStoreSubscription(db, { storeId, days, actorTelegramId });
      return toStoreView(updated);
    },
    async remove(storeId, actorTelegramId) {
      await stopStore(storeId);
      return detachStoreBot(db, { storeId, actorTelegramId });
    },
    handleWebhook,
    sendStoreMessage,
    async attachScrimBot(storeId, token, actorTelegramId) {
      const result = await attachScrimBot(db, config, { storeId, token, actorTelegramId });
      // restart so the market bot drops its scrim handlers and the scrims bot comes up
      setTimeout(() => void startStore(storeId), 500);
      return result.profile.username;
    },
    async detachScrimBot(storeId, actorTelegramId) {
      await detachScrimBot(db, { storeId, actorTelegramId });
      setTimeout(() => void startStore(storeId), 500);
    },
    botUsernameFor(storeId) {
      return bots.get(storeId)?.username;
    },
  };

  return {
    controller: platform,
    listings,
    inquiries,
    payments,
    stores,
    agent,
    async bootstrapLegacy() {
      const rewrap = await rewrapStoreTokens(db, config);
      if (rewrap.migrated > 0 || rewrap.failed > 0) {
        logger.info({ migrated: rewrap.migrated, failed: rewrap.failed }, "store tokens rewrapped");
      }
      const profile = await verifyBotToken(config.BOT_TOKEN);
      return bootstrapLegacyStore(db, config, profile);
    },
    async startAll() {
      const identity = await db.store.findMany({
        select: { id: true, title: true, botUsername: true, ownerTelegramId: true, ownerUsername: true },
      });
      logger.info(
        {
          envOwnerTelegramId: config.OWNER_TELEGRAM_ID,
          superAdminTelegramId: config.superAdminTelegramId,
          stores: identity.map((row) => ({
            storeId: row.id,
            botUsername: row.botUsername,
            ownerTelegramId: row.ownerTelegramId || null,
            emptyOwner: !String(row.ownerTelegramId ?? "").trim(),
          })),
        },
        "identity map",
      );
      for (const row of identity) {
        if (!String(row.ownerTelegramId ?? "").trim() && row.ownerUsername.replace(/^@/, "") === config.ownerUsername) {
          await db.store.update({
            where: { id: row.id },
            data: { ownerTelegramId: config.OWNER_TELEGRAM_ID },
          });
          logger.warn(
            { storeId: row.id, botUsername: row.botUsername, ownerTelegramId: config.OWNER_TELEGRAM_ID },
            "repaired empty store ownerTelegramId",
          );
        }
      }
      const rows = await db.store.findMany({
        where: { tokenCipher: { not: null } },
        orderBy: { createdAt: "asc" },
      });
      for (const row of rows) {
        await startStore(row.id);
      }
      logger.info({ count: bots.size, scrimBots: [...bots.values()].filter((b) => b.storeId && scrimBots.has(b.storeId)).length, pid: process.pid }, "store bots ready");
    },
    async tickScrims(now: Date) {
      for (const market of bots.values()) {
        const running = scrimBots.get(market.storeId) ?? market;
        try {
          await running.scrimTick?.(now);
        } catch (error) {
          logger.warn({ storeId: running.storeId, err: error instanceof Error ? error.message : String(error) }, "scrim tick failed");
        }
      }
    },
    async stopAll() {
      const ids = [...bots.keys()];
      for (const id of ids) {
        await stopStore(id);
      }
    },
  };
}
