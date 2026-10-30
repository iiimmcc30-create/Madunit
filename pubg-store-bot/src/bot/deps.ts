import type { PrismaClient } from "@prisma/client";
import type Redis from "ioredis";
import type { AppConfig } from "../config";
import type { Logger } from "../logger";
import type { LlmProvider } from "../llm";
import type { InquiryService } from "../services/inquiry";
import type { ListingService } from "../services/listing";
import type { PaymentService } from "../services/payment";
import type { StoreAgent } from "../agent/create";
import type { BotController } from "../bots/controller";
import type { StoreService } from "../services/store";
import type { DownloadedTelegramFile } from "../infra/telegram-file";

export interface AppDeps {
  config: AppConfig;
  db: PrismaClient;
  listings: ListingService;
  inquiries: InquiryService;
  payments: PaymentService;
  stores: StoreService;
  llm: LlmProvider;
  agent: StoreAgent;
  logger: Logger;
  botUsername: string;
  storeId: string;
  /** True only for the platform/management bot (the one running BOT_TOKEN). */
  isPlatformBot?: boolean;
  platform: BotController;
  downloadTelegramFile: (fileId: string, asDataUrl?: boolean) => Promise<DownloadedTelegramFile | null>;
  telegramFileUrl: (fileId: string) => Promise<string | null>;
  /** Used for short-lived scrim drop claims. */
  redis?: Redis;
}
