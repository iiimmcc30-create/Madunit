import type { Middleware } from "grammy";
import { isSuperAdmin } from "../../config";
import { isSubscriptionOpen, SERVICE_STOPPED_MESSAGE } from "../../domain/subscription";
import type { AppDeps } from "../deps";
import type { BotContext } from "../context";

function textOf(ctx: BotContext): string {
  return ctx.message?.text?.trim() ?? "";
}

function dataOf(ctx: BotContext): string {
  return ctx.callbackQuery?.data ?? "";
}

function isMaintenancePath(ctx: BotContext, ownerId: string, superAdmin: boolean): boolean {
  const text = textOf(ctx);
  const data = dataOf(ctx);
  if (/^\/(?:admin|cancel)(?:@\w+)?(?:\s|$)/i.test(text)) return true;
  if (data.startsWith("ad:") || data.startsWith("subpay:")) return true;
  if (superAdmin) return true;
  const isOwner = ctx.from && String(ctx.from.id) === ownerId;
  if (!isOwner) return false;
  if (/^\/(?:settings|setup|start|help|cancel)(?:@\w+)?(?:\s|$)/i.test(text)) return true;
  if (data.startsWith("st:") || data.startsWith("start:")) return true;
  if (ctx.session.pendingStoreSetting || ctx.session.pendingSubscriptionReceipt) return true;
  if (ctx.message?.photo && ctx.session.pendingSubscriptionReceipt) return true;
  return false;
}

export function createSubscriptionGate(deps: AppDeps): Middleware<BotContext> {
  return async (ctx, next) => {
    if (ctx.chat?.type !== "private") {
      await next();
      return;
    }
    const store = await deps.stores.getById(deps.storeId);
    const telegramId = String(ctx.from?.id ?? "");
    const superAdmin = isSuperAdmin(deps.config, telegramId);
    if (isSubscriptionOpen(store) && store.botEnabled) {
      await next();
      return;
    }
    if (isMaintenancePath(ctx, store.ownerTelegramId, superAdmin)) {
      await next();
      return;
    }
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: SERVICE_STOPPED_MESSAGE });
      return;
    }
    await ctx.reply(SERVICE_STOPPED_MESSAGE);
  };
}
