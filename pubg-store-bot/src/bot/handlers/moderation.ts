import type { Bot } from "grammy";
import { AppError } from "../../domain/errors";
import { parseBanTarget } from "../../domain/moderation";
import { formatAuditLine, listRecentAudit } from "../../services/audit";
import { banSeller, unbanSeller } from "../../services/seller";
import type { BotContext } from "../context";
import type { AppDeps } from "../deps";
import { texts } from "../texts";

export function registerModerationHandlers(bot: Bot<BotContext>, deps: AppDeps) {
  bot.command("ban", async (ctx) => {
    if (!(await deps.stores.isPrivilegedOwner(String(ctx.from?.id ?? "")))) {
      await ctx.reply(texts.notOwner);
      return;
    }
    const target = parseBanTarget(ctx.match || ctx.message?.text || "");
    if (!target) {
      await ctx.reply(texts.needBanTarget);
      return;
    }
    try {
      let telegramId = target.telegramId;
      if (target.listingCode) {
        const listing = await deps.listings.getInquiryByShortCode(target.listingCode, deps.storeId);
        telegramId = listing.sellerTelegramId;
      }
      if (!telegramId) {
        await ctx.reply(texts.needBanTarget);
        return;
      }
      const seller = await banSeller(deps.db, {
        actorTelegramId: String(ctx.from?.id ?? ""),
        ownerTelegramId: deps.config.OWNER_TELEGRAM_ID,
        targetTelegramId: telegramId,
        reason: target.reason,
      });
      await ctx.reply(texts.bannedOk(seller.telegramId));
    } catch (error) {
      await ctx.reply(error instanceof AppError ? error.userMessage : "صار خطأ، حاول مرة ثانية.");
    }
  });

  bot.command("unban", async (ctx) => {
    if (!(await deps.stores.isPrivilegedOwner(String(ctx.from?.id ?? "")))) {
      await ctx.reply(texts.notOwner);
      return;
    }
    const target = parseBanTarget(ctx.match || ctx.message?.text || "");
    if (!target) {
      await ctx.reply(texts.needBanTarget);
      return;
    }
    try {
      let telegramId = target.telegramId;
      if (target.listingCode) {
        const listing = await deps.listings.getInquiryByShortCode(target.listingCode, deps.storeId);
        telegramId = listing.sellerTelegramId;
      }
      if (!telegramId) {
        await ctx.reply(texts.needBanTarget);
        return;
      }
      const seller = await unbanSeller(deps.db, {
        actorTelegramId: String(ctx.from?.id ?? ""),
        ownerTelegramId: deps.config.OWNER_TELEGRAM_ID,
        targetTelegramId: telegramId,
      });
      await ctx.reply(texts.unbannedOk(seller.telegramId));
    } catch (error) {
      await ctx.reply(error instanceof AppError ? error.userMessage : "صار خطأ، حاول مرة ثانية.");
    }
  });

  bot.command("audit", async (ctx) => {
    if (!(await deps.stores.isPrivilegedOwner(String(ctx.from?.id ?? "")))) {
      await ctx.reply(texts.notOwner);
      return;
    }
    const rows = await listRecentAudit(deps.db, 15);
    if (rows.length === 0) {
      await ctx.reply(texts.auditEmpty);
      return;
    }
    await ctx.reply([texts.auditTitle, ...rows.map(formatAuditLine)].join("\n"));
  });
}
