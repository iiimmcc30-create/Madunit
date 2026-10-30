import type { Bot } from "grammy";
import { isSuperAdmin } from "../../config";
import { AppError } from "../../domain/errors";
import { bindStoreChannel, migrateStoreChat } from "../../services/platform";
import { importChannelListings } from "../../services/channel-sync";
import { setupErrorMessage } from "../conversations/setup-store";
import type { BotContext } from "../context";
import type { AppDeps } from "../deps";
import { texts } from "../texts";

/** Telegram's placeholder user for anonymous group admins. */
export const GROUP_ANONYMOUS_BOT_ID = 1087968824;

/**
 * /bind (or /setup) typed inside a group by its admin binds that group to this bot's store.
 * Also follows basic group -> supergroup migrations so the store keeps posting.
 */
export function registerGroupBindHandlers(bot: Bot<BotContext>, deps: AppDeps) {
  const groups = bot.chatType(["group", "supergroup"]);

  groups.command(["bind", "setup"], async (ctx) => {
    const from = ctx.from;
    if (!from || from.id === GROUP_ANONYMOUS_BOT_ID || ctx.message?.sender_chat) {
      await ctx.reply(texts.bindAnonymous);
      return;
    }
    const actor = String(from.id);
    try {
      const store = await deps.stores.getById(deps.storeId);
      const superAdmin = isSuperAdmin(deps.config, actor);
      if (!superAdmin && store.ownerTelegramId && store.ownerTelegramId !== actor) {
        await ctx.reply(texts.notOwner);
        return;
      }
      const result = await bindStoreChannel(deps.db, ctx.api, {
        storeId: deps.storeId,
        channelId: String(ctx.chat.id),
        actorTelegramId: actor,
        actorUsername: from.username,
        trialHours: deps.config.TRIAL_HOURS,
      });
      await ctx.reply(
        texts.setupChannelBound(result.store.title, result.store.channelId ?? String(ctx.chat.id), result.reusedTrial, result.chatType),
      );
      const scratch = actor;
      void importChannelListings(deps.db, ctx.api, deps.storeId, {
        scratchChatId: scratch,
        walkLimit: 150,
      })
        .then(async (sync) => {
          deps.logger.info({ storeId: deps.storeId, sync }, "post-bind channel sync");
          if (sync.imported + sync.updated > 0) {
            await ctx.api.sendMessage(scratch, texts.syncChannelOk(sync)).catch(() => undefined);
          }
        })
        .catch((err) => deps.logger.warn({ storeId: deps.storeId, err }, "post-bind channel sync failed"));
    } catch (error) {
      deps.logger.error({ storeId: deps.storeId, chatId: ctx.chat.id, err: error }, "group bind failed");
      await ctx.reply(
        setupErrorMessage(error, "صار خطأ أثناء ربط المجموعة. تأكد إن البوت مشرف وجرّب /bind مرة ثانية."),
      );
    }
  });

  bot.on("message:migrate_to_chat_id", async (ctx, next) => {
    await follow(String(ctx.chat.id), String(ctx.message.migrate_to_chat_id));
    await next();
  });
  bot.on("message:migrate_from_chat_id", async (ctx, next) => {
    const moved = await follow(String(ctx.message.migrate_from_chat_id), String(ctx.chat.id));
    if (moved) await ctx.reply(texts.bindGroupMigrated(String(ctx.chat.id))).catch(() => undefined);
    await next();
  });

  async function follow(from: string, to: string) {
    try {
      const store = await migrateStoreChat(deps.db, from, to);
      if (store) deps.logger.info({ storeId: store.id, from, to }, "store chat migrated");
      return store;
    } catch (error) {
      deps.logger.error({ err: error instanceof AppError ? error.message : error, from, to }, "store chat migrate failed");
      return null;
    }
  }
}
