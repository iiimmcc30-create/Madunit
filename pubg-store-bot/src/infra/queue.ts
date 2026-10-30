import { Queue, Worker } from "bullmq";
import type Redis from "ioredis";
import type { PrismaClient } from "@prisma/client";
import { inquiryJobDelays } from "../domain/inquiry-detect";
import type { AppConfig } from "../config";
import { texts } from "../bot/texts";
import type { Logger } from "../logger";
import type { InquiryService } from "../services/inquiry";
import {
  expireDueStores,
  listStoresNeedingReminder,
  markSubscriptionReminded,
} from "../services/subscription";

export interface InquiryJobs {
  schedule(inquiryId: string): Promise<void>;
  cancel(inquiryId: string): Promise<void>;
  close(): Promise<void>;
}

const REMINDER = "inquiry-reminder";
const TIMEOUT = "inquiry-timeout";

export function createInquiryJobs(
  connection: Redis,
  timeoutMinutes: number,
  graceMinutes: number,
): InquiryJobs {
  const delays = inquiryJobDelays(timeoutMinutes, graceMinutes);
  const reminderQueue = new Queue(REMINDER, { connection: connection as never });
  const timeoutQueue = new Queue(TIMEOUT, { connection: connection as never });

  return {
    async schedule(inquiryId: string) {
      // BullMQ custom jobId cannot contain ":".
      await reminderQueue.add(
        REMINDER,
        { inquiryId },
        { jobId: `${REMINDER}-${inquiryId}`, delay: delays.reminderMs, removeOnComplete: true },
      );
      await timeoutQueue.add(
        TIMEOUT,
        { inquiryId },
        { jobId: `${TIMEOUT}-${inquiryId}`, delay: delays.timeoutMs, removeOnComplete: true },
      );
    },
    async cancel(inquiryId: string) {
      await reminderQueue.remove(`${REMINDER}-${inquiryId}`).catch(() => undefined);
      await timeoutQueue.remove(`${TIMEOUT}-${inquiryId}`).catch(() => undefined);
      // تنظيف المعرفات القديمة إن وُجدت
      await reminderQueue.remove(`${REMINDER}:${inquiryId}`).catch(() => undefined);
      await timeoutQueue.remove(`${TIMEOUT}:${inquiryId}`).catch(() => undefined);
    },
    async close() {
      await reminderQueue.close();
      await timeoutQueue.close();
    },
  };
}

export function startInquiryWorkers(
  connection: Redis,
  inquiries: InquiryService,
  logger: Logger,
) {
  const workerConnection = connection.duplicate({ maxRetriesPerRequest: null });
  const reminderWorker = new Worker(
    REMINDER,
    async (job) => {
      await inquiries.remind(String(job.data.inquiryId));
    },
    { connection: workerConnection as never, concurrency: 5 },
  );
  const timeoutWorker = new Worker(
    TIMEOUT,
    async (job) => {
      await inquiries.timeout(String(job.data.inquiryId));
    },
    { connection: workerConnection as never, concurrency: 5 },
  );

  reminderWorker.on("failed", (job, error) => {
    logger.error({ err: error, jobId: job?.id }, "inquiry reminder failed");
  });
  timeoutWorker.on("failed", (job, error) => {
    logger.error({ err: error, jobId: job?.id }, "inquiry timeout failed");
  });

  return {
    async close() {
      await reminderWorker.close();
      await timeoutWorker.close();
      workerConnection.disconnect();
    },
  };
}

const SUBSCRIPTION = "subscription-maintenance";

export function startSubscriptionWorkers(
  connection: Redis,
  db: PrismaClient,
  config: AppConfig,
  logger: Logger,
  notifyOwner: (storeId: string, ownerTelegramId: string, text: string) => Promise<void>,
) {
  const workerConnection = connection.duplicate({ maxRetriesPerRequest: null });
  const queue = new Queue(SUBSCRIPTION, { connection: connection as never });
  const worker = new Worker(
    SUBSCRIPTION,
    async () => {
      await expireDueStores(db);
      const due = await listStoresNeedingReminder(db, {
        reminderHours: config.SUBSCRIPTION_REMINDER_HOURS,
      });
      for (const store of due) {
        if (!store.ownerTelegramId) continue;
        const until = store.subscriptionExpiresAt
          ? store.subscriptionExpiresAt.toISOString().slice(0, 16).replace("T", " ")
          : "";
        await notifyOwner(
          store.id,
          store.ownerTelegramId,
          texts.subscriptionReminder(
            until,
            String(config.SUBSCRIPTION_PRICE_SAR),
            config.SUBSCRIPTION_PAYMENT_INSTRUCTIONS,
          ),
        );
        await markSubscriptionReminded(db, store.id);
      }
    },
    { connection: workerConnection as never, concurrency: 1 },
  );
  worker.on("failed", (job, error) => {
    logger.error({ err: error, jobId: job?.id }, "subscription maintenance failed");
  });

  void queue
    .add(SUBSCRIPTION, {}, { jobId: "subscription-maintenance-once", removeOnComplete: true })
    .catch((error) => logger.warn({ err: error }, "subscription once job failed"));
  void queue
    .upsertJobScheduler(SUBSCRIPTION, { every: 60_000 }, { name: SUBSCRIPTION, data: {} })
    .catch((error) => logger.warn({ err: error }, "subscription repeat job failed"));

  return {
    async close() {
      await worker.close();
      await queue.close();
      workerConnection.disconnect();
    },
  };
}

const SCRIM_TICK = "scrim-tick";

/** Runs every minute: scheduled scrim opening, drops group lock/unlock, 30/5-minute reminders. */
export function startScrimWorkers(connection: Redis, logger: Logger, tick: (now: Date) => Promise<void>) {
  const workerConnection = connection.duplicate({ maxRetriesPerRequest: null });
  const queue = new Queue(SCRIM_TICK, { connection: connection as never });
  const worker = new Worker(
    SCRIM_TICK,
    async () => {
      await tick(new Date());
    },
    { connection: workerConnection as never, concurrency: 1 },
  );
  worker.on("failed", (job, error) => {
    logger.error({ err: error, jobId: job?.id }, "scrim tick failed");
  });
  void queue
    .upsertJobScheduler(SCRIM_TICK, { every: 60_000 }, { name: SCRIM_TICK, data: {} })
    .catch((error) => logger.warn({ err: error }, "scrim tick scheduler failed"));
  return {
    async close() {
      await worker.close();
      await queue.close();
      workerConnection.disconnect();
    },
  };
}

export function createQueuePort(redis: Redis) {
  return {
    ping: () => redis.ping(),
  };
}
