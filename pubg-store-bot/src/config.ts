import { z } from "zod";
import { parseTokenEncryptionKey } from "./infra/token-cipher";

const envSchema = z.object({
  BOT_TOKEN: z.string().min(1, "BOT_TOKEN مطلوب"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL مطلوب"),
  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),
  DEFAULT_CHANNEL_ID: z.string().min(1, "DEFAULT_CHANNEL_ID مطلوب"),
  OWNER_TELEGRAM_ID: z.string().min(1, "OWNER_TELEGRAM_ID مطلوب"),
  OWNER_USERNAME: z.string().min(1, "OWNER_USERNAME مطلوب"),
  SUPER_ADMIN_TELEGRAM_ID: z.string().optional().default(""),
  TOKEN_ENCRYPTION_KEY: z.string().optional().default(""),
  LISTING_FEE: z.coerce.number().nonnegative().default(0),
  PUBLISH_MODE: z.enum(["AUTO", "APPROVAL"]).default("AUTO"),
  INQUIRY_TIMEOUT_MINUTES: z.coerce.number().positive().default(15),
  INQUIRY_GRACE_MINUTES: z.coerce.number().nonnegative().default(5),
  OPENAI_API_KEY: z.string().optional().default(""),
  XAI_API_KEY: z.string().optional().default(""),
  ANTHROPIC_API_KEY: z.string().optional().default(""),
  LLM_PROVIDER: z.enum(["openai", "grok", "anthropic", "noop"]).default("openai"),
  LLM_MODEL: z.string().optional().default(""),
  LLM_FAST_MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_MODEL: z.string().default("gpt-4.1"),
  LLM_DAILY_BUDGET_USD: z.coerce.number().nonnegative().default(3),
  LLM_TIMEOUT_MS: z.coerce.number().positive().default(20000),
  LLM_INPUT_PRICE_PER_MILLION: z.coerce.number().nonnegative().default(2.5),
  LLM_OUTPUT_PRICE_PER_MILLION: z.coerce.number().nonnegative().default(10),
  SELLER_DAILY_LISTING_LIMIT: z.coerce.number().int().nonnegative().default(10),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_MAX: z.coerce.number().int().nonnegative().default(40),
  WEB_PORT: z.coerce.number().int().positive().default(3780),
  WEB_PUBLIC_URL: z.string().default("http://127.0.0.1:3780"),
  BOT_USERNAME: z.string().optional().default(""),
  DASHBOARD_TOKEN: z.string().optional().default(""),
  LANDING_CONTACT_TELEGRAM: z.string().optional().default(""),
  WEBHOOK_URL: z.string().optional().default(""),
  WEBHOOK_SECRET: z.string().optional().default(""),
  TRIAL_HOURS: z.coerce.number().positive().default(48),
  SUBSCRIPTION_DAYS: z.coerce.number().positive().default(30),
  SUBSCRIPTION_PRICE_SAR: z.coerce.number().nonnegative().default(99),
  SUBSCRIPTION_REMINDER_HOURS: z.coerce.number().positive().default(12),
  SUBSCRIPTION_PAYMENT_INSTRUCTIONS: z
    .string()
    .optional()
    .default("حوّل 99 ريال لحساب مالك المنصة، ثم أرسل صورة الإيصال هنا من زر تجديد الاشتراك."),
  CJ_API_KEY: z.string().optional().default(""),
  CJ_PAY_TYPE: z.coerce.number().int().refine((v) => v === 2 || v === 3).default(3),
  CJ_DEFAULT_LOGISTIC: z.string().default("CJPacket Liquid Line"),
  CJ_TOKEN_CACHE_FILE: z.string().optional().default(""),
  SHOP_USD_TO_SAR: z.coerce.number().positive().default(3.75),
  SHOP_DEFAULT_MARKUP_PERCENT: z.coerce.number().nonnegative().default(120),
  SHOP_TRACKING_SYNC_MINUTES: z.coerce.number().nonnegative().default(30),
  SHOP_ADMIN_CHAT_IDS: z.string().optional().default(""),
  LOG_LEVEL: z.string().default("info"),
  NODE_ENV: z.string().default("development"),
});

export type AppConfig = z.infer<typeof envSchema> & {
  ownerUsername: string;
  superAdminTelegramId: string;
  shopAdminChatIds: string[];
  tokenEncryptionKey: Buffer;
  LLM_MODEL: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);
  const model = parsed.LLM_MODEL.trim() || parsed.OPENAI_MODEL;
  const superAdminTelegramId = (parsed.SUPER_ADMIN_TELEGRAM_ID || parsed.OWNER_TELEGRAM_ID).trim();
  // Shop order alerts go to the super admin plus any extra comma-separated ids (deduplicated).
  const shopAdminChatIds = [
    ...new Set(
      [superAdminTelegramId, ...parsed.SHOP_ADMIN_CHAT_IDS.split(/[,\s]+/)].map((id) => id.trim()).filter(Boolean),
    ),
  ];
  return {
    ...parsed,
    OPENAI_MODEL: model,
    LLM_MODEL: model,
    ownerUsername: parsed.OWNER_USERNAME.replace(/^@/, ""),
    superAdminTelegramId,
    shopAdminChatIds,
    tokenEncryptionKey: parseTokenEncryptionKey(parsed.TOKEN_ENCRYPTION_KEY, parsed.BOT_TOKEN),
  };
}

export function isSuperAdmin(config: Pick<AppConfig, "superAdminTelegramId">, telegramId: string): boolean {
  return Boolean(telegramId) && telegramId === config.superAdminTelegramId;
}

export function usesWebhook(config: Pick<AppConfig, "WEBHOOK_URL">): boolean {
  return Boolean(config.WEBHOOK_URL.trim());
}

export function webhookPublicBase(config: Pick<AppConfig, "WEBHOOK_URL" | "WEB_PUBLIC_URL">): string {
  const raw = (config.WEBHOOK_URL.trim() || config.WEB_PUBLIC_URL.trim()).replace(/\/$/, "");
  return raw.replace(/\/telegram\/webhook.*$/, "");
}

export function webhookUrlForStore(
  config: Pick<AppConfig, "WEBHOOK_URL" | "WEB_PUBLIC_URL">,
  storeId: string,
): string {
  return `${webhookPublicBase(config)}/telegram/webhook/${storeId}`;
}

export function parseWebhookStoreId(pathname: string): string | null {
  const match = pathname.match(/^\/telegram\/webhook\/([^/]+)$/);
  return match?.[1] && match[1] !== "webhook" ? match[1] : null;
}

export function webhookPath(config: Pick<AppConfig, "WEBHOOK_URL">): string {
  if (!config.WEBHOOK_URL.trim()) return "/telegram/webhook";
  try {
    const path = new URL(config.WEBHOOK_URL).pathname;
    return path && path !== "/" ? path : "/telegram/webhook";
  } catch {
    return "/telegram/webhook";
  }
}
