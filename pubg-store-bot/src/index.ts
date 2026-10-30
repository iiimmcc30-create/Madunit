import "dotenv/config";
import { loadConfig, usesWebhook } from "./config";
import { createLogger } from "./logger";
import { createBotPlatform } from "./bots/runtime";
import { createPrisma } from "./infra/prisma";
import { createRedis } from "./infra/redis";
import { createInquiryJobs, createQueuePort, startInquiryWorkers, startScrimWorkers, startSubscriptionWorkers } from "./infra/queue";
import { createLlmProvider } from "./llm";
import { startHttpServer } from "./web/server";
import { ShopService } from "./shop/service";

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL, config.NODE_ENV);
  const db = createPrisma();
  const redis = createRedis(config.REDIS_URL, logger);
  const bullRedis = createRedis(config.REDIS_URL, logger, { maxRetriesPerRequest: null });
  const queue = createQueuePort(redis);
  const budgetHook: { send?: (spent: number, cap: number) => Promise<void> } = {};
  const llm = createLlmProvider(config, redis, db, {
    onBudgetLow: async (spent, cap) => {
      await budgetHook.send?.(spent, cap);
    },
  });

  await db.$connect();
  await redis.ping();
  await queue.ping();

  const jobs = createInquiryJobs(
    bullRedis,
    config.INQUIRY_TIMEOUT_MINUTES,
    config.INQUIRY_GRACE_MINUTES,
  );
  const platform = createBotPlatform({ config, db, redis, llm, logger, jobs });
  const legacy = await platform.bootstrapLegacy();
  budgetHook.send = async (spent, cap) => {
    await platform.controller.sendStoreMessage(
      legacy.id,
      config.superAdminTelegramId,
      `ميزانية الذكاء اليوم وصلت ${spent.toFixed(2)}$ من ${cap}$. قرّبت تخلص.`,
    );
  };
  logger.info(
    {
      llm: llm.name,
      model: config.LLM_MODEL,
      publishMode: config.PUBLISH_MODE,
      inquiryTimeoutMinutes: config.INQUIRY_TIMEOUT_MINUTES,
      webPort: config.WEB_PORT,
      webhook: usesWebhook(config),
      trialHours: config.TRIAL_HOURS,
      legacyStoreId: legacy.id,
      legacyBot: legacy.botUsername,
    },
    "starting pubg-store-bot",
  );
  await platform.startAll();

  const inquiryWorkers = startInquiryWorkers(bullRedis, platform.inquiries, logger);
  const subscriptionWorkers = startSubscriptionWorkers(
    bullRedis,
    db,
    config,
    logger,
    (storeId, ownerId, text) => platform.controller.sendStoreMessage(storeId, ownerId, text),
  );
  const scrimWorkers = startScrimWorkers(bullRedis, logger, (now) => platform.tickScrims(now));
  const shop = new ShopService(
    db,
    {
      cjApiKey: config.CJ_API_KEY,
      usdToSar: config.SHOP_USD_TO_SAR,
      defaultMarkupPercent: config.SHOP_DEFAULT_MARKUP_PERCENT,
      defaultLogistic: config.CJ_DEFAULT_LOGISTIC,
      cjPayType: config.CJ_PAY_TYPE as 2 | 3,
      tokenCacheFile: config.CJ_TOKEN_CACHE_FILE || undefined,
    },
    async (text) => {
      try {
        await platform.controller.sendStoreMessage(legacy.id, config.superAdminTelegramId, text);
      } catch (error) {
        logger.warn({ err: error }, "shop notify failed");
      }
    },
  );
  const shopSync =
    config.CJ_API_KEY && config.SHOP_TRACKING_SYNC_MINUTES > 0
      ? setInterval(() => {
          shop.syncTracking().catch((error) => logger.warn({ err: error }, "shop tracking sync failed"));
        }, config.SHOP_TRACKING_SYNC_MINUTES * 60_000)
      : null;
  const httpServer = startHttpServer(config, db, redis, platform.controller, shop);

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down");
    await platform.stopAll();
    if (shopSync) clearInterval(shopSync);
    httpServer.close();
    await inquiryWorkers.close();
    await subscriptionWorkers.close();
    await scrimWorkers.close();
    await jobs.close();
    await db.$disconnect();
    redis.disconnect();
    bullRedis.disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
