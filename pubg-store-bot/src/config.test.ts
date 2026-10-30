import { describe, expect, it } from "vitest";
import { loadConfig, parseWebhookStoreId, usesWebhook, webhookPath, webhookUrlForStore } from "./config";

const valid = {
  BOT_TOKEN: "123:abc",
  DATABASE_URL: "postgresql://pubg:pubg@127.0.0.1:5432/pubg_store",
  DEFAULT_CHANNEL_ID: "-1001",
  OWNER_TELEGRAM_ID: "99",
  OWNER_USERNAME: "@Shop_Owner",
};

describe("loadConfig", () => {
  it("strips @ from owner username and applies defaults", () => {
    const config = loadConfig(valid);
    expect(config.ownerUsername).toBe("Shop_Owner");
    expect(config.OPENAI_MODEL).toBe("gpt-4.1");
    expect(config.LLM_MODEL).toBe("gpt-4.1");
    expect(config.LLM_FAST_MODEL).toBe("gpt-4o-mini");
    expect(config.LLM_PROVIDER).toBe("openai");
    expect(config.PUBLISH_MODE).toBe("AUTO");
    expect(config.LISTING_FEE).toBe(0);
    expect(config.INQUIRY_TIMEOUT_MINUTES).toBe(15);
    expect(config.INQUIRY_GRACE_MINUTES).toBe(5);
    expect(config.LLM_DAILY_BUDGET_USD).toBe(3);
    expect(config.SELLER_DAILY_LISTING_LIMIT).toBe(10);
    expect(config.RATE_LIMIT_MAX).toBe(40);
    expect(config.WEB_PORT).toBe(3780);
    expect(config.WEBHOOK_URL).toBe("");
    expect(usesWebhook(config)).toBe(false);
    expect(webhookPath(config)).toBe("/telegram/webhook");
    expect(
      webhookPath({
        WEBHOOK_URL: "https://getsarh.tech/telegram/webhook",
      }),
    ).toBe("/telegram/webhook");
    expect(config.superAdminTelegramId).toBe("99");
    expect(config.TRIAL_HOURS).toBe(48);
    expect(config.SUBSCRIPTION_PRICE_SAR).toBe(99);
    expect(config.tokenEncryptionKey.length).toBe(32);
    expect(parseWebhookStoreId("/telegram/webhook/store_1")).toBe("store_1");
    expect(parseWebhookStoreId("/telegram/webhook")).toBeNull();
    expect(
      webhookUrlForStore(
        { WEBHOOK_URL: "https://getsarh.tech/telegram/webhook", WEB_PUBLIC_URL: "https://getsarh.tech" },
        "store_1",
      ),
    ).toBe("https://getsarh.tech/telegram/webhook/store_1");
  });

  it("rejects missing bot token", () => {
    expect(() => loadConfig({ ...valid, BOT_TOKEN: "" })).toThrow();
  });
});
