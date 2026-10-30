import type { Bot } from "grammy";
import { isSuperAdmin } from "../../config";
import {
  ADMIN_INTENT_SYSTEM_PROMPT,
  classifyAdminIntent,
  normalizeArabic,
  parseAdminIntentJson,
  type AdminIntent,
} from "../../domain/admin-intent";
import { AppError } from "../../domain/errors";
import type { StoreView } from "../../services/store";
import type { BotContext } from "../context";
import type { AppDeps } from "../deps";
import { platformMenuKeyboard } from "../keyboards";
import { texts } from "../texts";
import { BOT_TOKEN_RE, sendPendingPayments, sendStoresOverview } from "./admin";

/** Picks the store the admin named (by @username, bot username or title). */
export function matchStores(stores: StoreView[], target: string | undefined): StoreView[] {
  if (!target) return [];
  const needle = normalizeArabic(target.replace(/^@/, ""));
  if (!needle) return [];
  const exact = stores.filter((s) => normalizeArabic(s.botUsername) === needle);
  if (exact.length) return exact;
  return stores.filter((s) =>
    [s.botUsername, s.title, s.ownerUsername, s.botFirstName]
      .map((v) => normalizeArabic(v || ""))
      .some((v) => v && (v.includes(needle) || needle.includes(v))),
  );
}

async function llmIntent(deps: AppDeps, text: string): Promise<AdminIntent> {
  if (!deps.llm || deps.llm.name === "noop") return { kind: "unknown" };
  try {
    const turn = await Promise.race([
      deps.llm.runAgentTurn({
        system: ADMIN_INTENT_SYSTEM_PROMPT,
        messages: [{ role: "user", content: text.slice(0, 500) }],
        tools: [],
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);
    return parseAdminIntentJson(turn?.content);
  } catch (error) {
    deps.logger.warn({ err: error }, "platform intent llm failed");
    return { kind: "unknown" };
  }
}

export async function resolveAdminIntent(deps: AppDeps, text: string): Promise<AdminIntent> {
  const heuristic = classifyAdminIntent(text);
  if (heuristic.kind !== "unknown") return heuristic;
  return llmIntent(deps, text);
}

const ACTION_LABEL: Record<string, string> = {
  disable_store: "اضغط «إيقاف» على المتجر المطلوب.",
  enable_store: "اضغط «تفعيل» على المتجر المطلوب.",
  delete_store: "اضغط «حذف البوت» على المتجر المطلوب (يوقف البوت ويشيل التوكن، والبيانات تبقى).",
  unbind_channel: "اضغط «فك ربط القناة/المجموعة» على المتجر المطلوب، وبعدها أكّد.",
  extend: "اضغط «تعيين أيام التفعيل» على المتجر المطلوب وأرسل عدد الأيام.",
  scrim_link: "اضغط «ربط بوت سكرمات» على المتجر المطلوب وأرسل التوكن.",
};

async function sendMenu(ctx: BotContext, prefix?: string) {
  await ctx.reply(prefix ? `${prefix}\n\n${texts.platformMenu}` : texts.platformMenu, {
    reply_markup: platformMenuKeyboard(),
  });
}

async function runIntent(ctx: BotContext, deps: AppDeps, intent: AdminIntent) {
  switch (intent.kind) {
    case "add_bot":
      ctx.session.pendingAdminAction = { kind: "add_token" };
      await ctx.reply(texts.adminAskToken);
      return;
    case "list_stores":
    case "status":
      await sendStoresOverview(ctx, deps);
      return;
    case "stats":
      await sendStoresOverview(ctx, deps, { cards: [] });
      return;
    case "subscriptions":
      await sendPendingPayments(ctx, deps);
      return;
    case "bind_channel":
      await ctx.reply(texts.platformBindChannelHint);
      return;
    case "create_ad":
      await ctx.reply(texts.platformNoAds);
      return;
    case "help":
      await sendMenu(ctx);
      return;
    case "unknown":
      await sendMenu(ctx, texts.platformNotUnderstood);
      return;
    default: {
      const stores = await deps.stores.list();
      const matched = matchStores(stores, intent.target);
      const hint = ACTION_LABEL[intent.kind] ?? "";
      if (matched.length) {
        await sendStoresOverview(ctx, deps, { cards: matched, note: hint });
      } else {
        await sendStoresOverview(ctx, deps, {
          note: `${intent.target ? `ما لقيت متجر باسم «${intent.target}». ` : ""}${hint}`,
        });
      }
    }
  }
}

/** Commands/callbacks that must win over the store-bot defaults. Register early. */
export function registerPlatformCommands(bot: Bot<BotContext>, deps: AppDeps) {
  const admin = (ctx: BotContext) => isSuperAdmin(deps.config, String(ctx.from?.id ?? ""));

  const home = async (ctx: BotContext) => {
    await ctx.conversation.exitAll();
    if (ctx.chat?.type !== "private") return;
    if (!admin(ctx)) {
      await ctx.reply(texts.platformPublic);
      return;
    }
    await sendMenu(ctx);
  };
  bot.command(["start", "help", "menu"], home);
  bot.callbackQuery("pm:help", async (ctx) => {
    await ctx.answerCallbackQuery();
    await home(ctx);
  });
  bot.callbackQuery(/^pm:(stores|status|stats)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!admin(ctx)) return;
    const which = ctx.callbackQuery.data.slice(3);
    await sendStoresOverview(ctx, deps, which === "stats" ? { cards: [] } : {});
  });
  // no listing flow on the platform bot
  bot.callbackQuery("start:list", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(texts.platformNoAds);
  });
  bot.command(["sell", "sold", "delete"], async (ctx) => {
    await ctx.reply(texts.platformNoAds);
  });
}

/** Final catch-all for private messages on the platform bot (replaces the store agent). */
export function registerPlatformText(bot: Bot<BotContext>, deps: AppDeps) {
  bot.on("message", async (ctx, next) => {
    if (ctx.chat.type !== "private" || !ctx.from) {
      await next();
      return;
    }
    const text = (ctx.message.text ?? ctx.message.caption ?? "").trim();
    if (text.startsWith("/")) {
      await next();
      return;
    }
    if (!isSuperAdmin(deps.config, String(ctx.from.id))) {
      await ctx.reply(texts.platformPublic);
      return;
    }
    if (ctx.message.video || ctx.message.animation) {
      await ctx.reply(texts.platformNoAds);
      return;
    }
    if (!text) {
      await sendMenu(ctx);
      return;
    }
    if (BOT_TOKEN_RE.test(text)) {
      await ctx.deleteMessage().catch(() => undefined);
      try {
        await ctx.reply("لحظة، أتحقق من التوكن وأشغّل البوت…");
        const store = await deps.platform.addFromToken(text, String(ctx.from.id));
        await ctx.reply(texts.adminStoreAdded(store.botUsername || store.title));
        ctx.session.pendingAdminAction = { kind: "extend", storeId: store.id, alsoEnable: true };
        await ctx.reply(texts.adminAskActivationDays);
      } catch (error) {
        await ctx.reply(error instanceof AppError ? error.userMessage : "ما قدرت أضيف البوت.");
      }
      return;
    }
    try {
      const intent = await resolveAdminIntent(deps, text);
      deps.logger.info({ kind: intent.kind, target: intent.target }, "platform intent");
      await runIntent(ctx, deps, intent);
    } catch (error) {
      deps.logger.error({ err: error }, "platform intent failed");
      await ctx.reply(error instanceof AppError ? error.userMessage : "صار خطأ، جرّب مرة ثانية.");
    }
  });
}
