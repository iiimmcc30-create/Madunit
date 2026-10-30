import type { Api, Bot } from "grammy";
import { AppError } from "../../domain/errors";
import { displayLeader, parseGroupReviewReply, teamIdFromReviewMarkup } from "../../domain/scrim-group";
import { ensureScrimTemplate, isScrimOperator, reviewTeamProof, updateScrimTemplate } from "../../services/scrim";
import type { BotContext } from "../context";
import type { AppDeps } from "../deps";
import { texts } from "../texts";

export function scrimReviewKeyboard(teamId: string) {
  return {
    inline_keyboard: [
      [
        { text: "✅ قبول", callback_data: `sc:ok:${teamId}` },
        { text: "❌ رفض", callback_data: `sc:no:${teamId}` },
      ],
    ],
  };
}

/**
 * Sends a registration card. With an organizers group set, it goes to the group
 * (photo + buttons when review is needed). Without one, only proof reviews go to
 * the owner DM, exactly like before.
 */
export async function announceTeamRegistration(
  api: Api,
  deps: AppDeps,
  input: {
    teamId: string;
    tag: string;
    status: string;
    leader: { id: string; username?: string | null };
    photoFileId?: string | null;
    needsReview: boolean;
  },
): Promise<"group" | "owner" | "none"> {
  const template = await ensureScrimTemplate(deps.db, deps.storeId);
  const caption = texts.scrimGroupCard({
    tag: input.tag,
    status: texts.scrimTeamStatusLabel(input.status),
    leader: displayLeader(input.leader),
    needsReview: input.needsReview,
  });
  const markup = input.needsReview ? scrimReviewKeyboard(input.teamId) : undefined;
  if (template.organizersGroupId) {
    try {
      if (input.photoFileId) {
        await api.sendPhoto(template.organizersGroupId, input.photoFileId, {
          caption: caption.slice(0, 1024),
          reply_markup: markup,
        });
      } else {
        await api.sendMessage(template.organizersGroupId, caption, { reply_markup: markup });
      }
      return "group";
    } catch (error) {
      deps.logger.warn({ err: error instanceof Error ? error.message : String(error) }, "scrim group post failed");
      if (!input.needsReview) return "none";
      // fall through to owner DM so a review never gets lost
    }
  }
  if (!input.needsReview) return "none";
  const store = await deps.stores.getById(deps.storeId);
  if (input.photoFileId) {
    await api.sendPhoto(store.ownerTelegramId, input.photoFileId, {
      caption: caption.slice(0, 1024),
      reply_markup: markup,
    });
  } else {
    await api.sendMessage(store.ownerTelegramId, caption, { reply_markup: markup });
  }
  return "owner";
}

/** Shared ✅/❌ logic used by the buttons and by «تم»/«رفض» replies in the group. */
export async function applyTeamReview(api: Api, deps: AppDeps, input: { teamId: string; accept: boolean; actorTelegramId: string }) {
  const template = await ensureScrimTemplate(deps.db, deps.storeId);
  const reviewed = await reviewTeamProof(deps.db, {
    storeId: deps.storeId,
    teamId: input.teamId,
    actorTelegramId: input.actorTelegramId,
    accept: input.accept,
  });
  const leaderId = reviewed.team.leaderTelegramId;
  if (/^\d+$/.test(leaderId)) {
    const msg = reviewed.accepted
      ? reviewed.next === "waitlist"
        ? "تم قبولك، بس المقاعد اكتملت. نضيفك للاحتياط ونرقّيك إذا فُتح مقعد."
        : `تم قبولك. اكتب «${template.committedPhrase}» لتثبيت مقعدك.`
      : "المنظمين رفضوا صورة التحقق. تقدر تراسلهم.";
    try {
      await api.sendMessage(leaderId, msg);
    } catch {
      // player may have blocked the bot
    }
  }
  return reviewed;
}

function actorLabel(ctx: BotContext): string {
  const from = ctx.from;
  if (!from) return "—";
  return from.username ? `@${from.username}` : from.first_name || String(from.id);
}

async function isOperator(deps: AppDeps, telegramId: string): Promise<boolean> {
  const store = await deps.stores.getById(deps.storeId);
  const template = await ensureScrimTemplate(deps.db, deps.storeId);
  return isScrimOperator(store.ownerTelegramId, telegramId, deps.config.superAdminTelegramId, template.moderatorTelegramIds);
}

function isGroupChat(ctx: BotContext): boolean {
  return ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
}

export function registerScrimGroupHandlers(bot: Bot<BotContext>, deps: AppDeps) {
  bot.command("scrim_group", async (ctx) => {
    const actor = String(ctx.from?.id ?? "");
    if (!(await isOperator(deps, actor))) {
      if (!isGroupChat(ctx)) await ctx.reply(texts.notOwner);
      return;
    }
    const arg = (typeof ctx.match === "string" ? ctx.match : "").trim();
    if (/^(off|حذف|الغاء|إلغاء)$/i.test(arg)) {
      await updateScrimTemplate(deps.db, deps.storeId, { organizersGroupId: null });
      await ctx.reply(texts.scrimGroupCleared);
      return;
    }
    if (!isGroupChat(ctx) || !ctx.chat) {
      await ctx.reply(texts.scrimGroupOnlyInGroup);
      return;
    }
    try {
      const me = await ctx.api.getChatMember(ctx.chat.id, ctx.me.id);
      if (me.status !== "administrator" && me.status !== "creator") {
        await ctx.reply(texts.scrimGroupNeedAdmin);
        return;
      }
    } catch {
      await ctx.reply(texts.scrimGroupNeedAdmin);
      return;
    }
    await updateScrimTemplate(deps.db, deps.storeId, { organizersGroupId: String(ctx.chat.id) });
    await ctx.reply(texts.scrimGroupSaved);
  });

  bot.on("message:text", async (ctx, next) => {
    if (!isGroupChat(ctx)) {
      await next();
      return;
    }
    const replied = ctx.message.reply_to_message;
    const decision = parseGroupReviewReply(ctx.message.text);
    if (!replied || !decision || replied.from?.id !== ctx.me.id) {
      await next();
      return;
    }
    const template = await ensureScrimTemplate(deps.db, deps.storeId);
    if (!template.organizersGroupId || template.organizersGroupId !== String(ctx.chat.id)) {
      await next();
      return;
    }
    const teamId = teamIdFromReviewMarkup(replied.reply_markup as never);
    if (!teamId) return;
    const actor = String(ctx.from?.id ?? "");
    if (!(await isOperator(deps, actor))) {
      await ctx.reply(texts.scrimGroupNotOperator, { reply_parameters: { message_id: ctx.message.message_id } });
      return;
    }
    try {
      await applyTeamReview(ctx.api, deps, { teamId, accept: decision === "accept", actorTelegramId: actor });
      const by = actorLabel(ctx);
      try {
        await ctx.api.editMessageReplyMarkup(ctx.chat.id, replied.message_id, { reply_markup: { inline_keyboard: [] } });
      } catch {
        // message may be too old to edit
      }
      await ctx.reply(decision === "accept" ? texts.scrimGroupApproved(by) : texts.scrimGroupRejected(by), {
        reply_parameters: { message_id: replied.message_id },
      });
    } catch (error) {
      await ctx.reply(error instanceof AppError ? error.userMessage : "ما تمت المراجعة.", {
        reply_parameters: { message_id: ctx.message.message_id },
      });
    }
  });
}

export { actorLabel as scrimActorLabel, isGroupChat as isScrimGroupChat };
