import { externalApp } from "./external";
import { Api } from "grammy";
import {
  describeSetupInput,
  parseSetupChannelInput,
  toTelegramChatRef,
  type ChannelBindHit,
} from "../../domain/channel";
import { AppError } from "../../domain/errors";
import { isSuperAdmin } from "../../config";
import { bindStoreChannel } from "../../services/platform";
import { importChannelListings } from "../../services/channel-sync";
import { removeReplyKeyboard, setupChannelKeyboard } from "../keyboards";
import type { InsideContext, ListingConversation } from "../context";
import type { AppDeps } from "../deps";
import { texts } from "../texts";

function isCancel(ctx: InsideContext): boolean {
  const text = ctx.message?.text?.trim();
  return Boolean(text && /^\/cancel(?:@\w+)?$/i.test(text));
}

async function resolveChannelId(api: Api, hit: ChannelBindHit): Promise<string> {
  const chat = await api.getChat(toTelegramChatRef(hit));
  if (chat.type !== "channel" && chat.type !== "supergroup" && chat.type !== "group") {
    throw new AppError("not a channel", texts.setupNotChannel, "NOT_CHANNEL");
  }
  return String(chat.id);
}

/** Turns a bind/resolve failure into clear step-by-step Arabic guidance. */
export function setupErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof AppError)) return fallback;
  switch (error.code) {
    case "BOT_NOT_ADMIN":
      return /المجموعة/.test(error.userMessage)
        ? texts.setupBotNotGroupAdminSteps(error.userMessage)
        : texts.setupBotNotAdminSteps(error.userMessage);
    case "CHANNEL_NOT_FOUND":
      return texts.setupChannelNotFound;
    case "CONFLICT":
      return error.message === "trial channel" ? texts.setupTrialUsed : texts.setupChannelTaken;
    default:
      return error.userMessage || fallback;
  }
}

export function makeSetupStoreConversation(deps: AppDeps) {
  return async function setupStore(conversation: ListingConversation, ctx: InsideContext) {
    const from = ctx.from;
    if (!from) {
      await ctx.reply("ما قدرت أتعرف عليك.");
      return;
    }
    const actorTelegramId = String(from.id);
    const store = await externalApp(conversation, () => deps.stores.getById(deps.storeId));
    const allowed =
      isSuperAdmin(deps.config, actorTelegramId) ||
      !store.ownerTelegramId ||
      store.ownerTelegramId === actorTelegramId;
    if (!allowed) {
      await ctx.reply(texts.notOwner);
      return;
    }

    await ctx.reply(texts.setupAskChannel, { reply_markup: setupChannelKeyboard() });

    let channelId: string | null = null;
    while (!channelId) {
      const next = await conversation.wait();
      if (isCancel(next)) {
        await next.reply(texts.cancelled, { reply_markup: removeReplyKeyboard() });
        return;
      }

      const snapshot = describeSetupInput(next);
      await externalApp(conversation, () => {
        deps.logger.info({ storeId: deps.storeId, ...snapshot }, "setup channel input");
      });

      const parsed = parseSetupChannelInput(next);
      if (parsed.kind === "hidden_forward") {
        await next.reply(texts.setupHiddenForward, { reply_markup: setupChannelKeyboard() });
        continue;
      }
      if (parsed.kind === "user_forward") {
        await next.reply(texts.setupUserForward, { reply_markup: setupChannelKeyboard() });
        continue;
      }
      if (!("value" in parsed)) {
        await next.reply(texts.setupNeedChannel, { reply_markup: setupChannelKeyboard() });
        continue;
      }

      try {
        channelId = await externalApp(conversation, () => resolveChannelId(next.api, parsed));
      } catch (error) {
        const message = setupErrorMessage(error, texts.setupChannelNotFound);
        await next.reply(message, { reply_markup: setupChannelKeyboard() });
      }
    }

    try {
      const result = await externalApp(conversation, () =>
        bindStoreChannel(deps.db, ctx.api, {
          storeId: deps.storeId,
          channelId,
          actorTelegramId,
          actorUsername: from.username,
          trialHours: deps.config.TRIAL_HOURS,
          skipActorCheck: isSuperAdmin(deps.config, actorTelegramId),
        }),
      );
      await ctx.reply(
        texts.setupChannelBound(
          result.store.title,
          result.store.channelId ?? channelId,
          result.reusedTrial,
          result.chatType,
        ),
        { reply_markup: removeReplyKeyboard() },
      );
      // Async channel history sync — never block bind on failure
      const scratch = String(from.id);
      const api = ctx.api;
      void importChannelListings(deps.db, api, deps.storeId, {
        scratchChatId: scratch,
        walkLimit: 150,
      })
        .then(async (sync) => {
          deps.logger.info({ storeId: deps.storeId, sync }, "post-bind channel sync");
          if (sync.imported + sync.updated > 0) {
            await api.sendMessage(scratch, texts.syncChannelOk(sync)).catch(() => undefined);
          } else if (sync.error) {
            deps.logger.warn({ storeId: deps.storeId, err: sync.error }, "post-bind sync soft-fail");
          }
        })
        .catch((err) => deps.logger.warn({ storeId: deps.storeId, err }, "post-bind channel sync failed"));
    } catch (error) {
      await externalApp(conversation, () => {
        deps.logger.error({ storeId: deps.storeId, channelId, err: error }, "setup bind failed");
      });
      await ctx.reply(
        setupErrorMessage(error, "صار خطأ أثناء ربط القناة. جرّب مرة ثانية أو أرسل /cancel."),
        { reply_markup: setupChannelKeyboard() },
      );
    }
  };
}
