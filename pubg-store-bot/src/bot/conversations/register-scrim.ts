import { externalApp } from "./external";
import { AppError } from "../../domain/errors";
import { isCommitPhrase } from "../../domain/scrim-tag";
import {
  commitTeam,
  ensureScrimTemplate,
  findJoinableScrim,
  startTeamJoin,
  submitTeamProof,
} from "../../services/scrim";
import type { InsideContext, ListingConversation } from "../context";
import type { AppDeps } from "../deps";
import { scrimWaitlistKeyboard } from "../keyboards";
import { announceTeamRegistration } from "../handlers/scrim-review";
import { withDropsLink } from "../../domain/scrim-group";

function isCancel(ctx: InsideContext): boolean {
  const text = ctx.message?.text?.trim();
  return Boolean(text && /^\/cancel(?:@\w+)?$/i.test(text));
}

export function makeRegisterScrimConversation(deps: AppDeps) {
  return async function registerScrim(
    conversation: ListingConversation,
    ctx: InsideContext,
    pending?: { scrimId?: string },
  ) {
    const leaderId = String(ctx.from?.id ?? "");
    if (!leaderId) {
      await ctx.reply("افتح البوت من الخاص أول.");
      return;
    }

    const scrim = await externalApp(conversation, () =>
      findJoinableScrim(deps.db, deps.storeId, pending?.scrimId),
    );
    if (!scrim) {
      await ctx.reply("ما فيه سكرم مفتوح للتسجيل الحين.");
      return;
    }
    if (scrim.status !== "OPEN" && scrim.status !== "LOCKED") {
      await ctx.reply("التسجيل مقفل بهالسكرم.");
      return;
    }

    await ctx.reply("أرسل تاق الفريق (حروف وأرقام).");
    const tagCtx = await conversation.waitUntil(
      (update) => Boolean(update.message?.text) || isCancel(update),
      { otherwise: (update) => update.reply("أرسل التاق كنص، أو /cancel.") },
    );
    if (isCancel(tagCtx)) {
      await tagCtx.reply("تم الإلغاء.");
      return;
    }
    const tag = tagCtx.message!.text!.trim();

    let decision;
    try {
      decision = await externalApp(conversation, () =>
        startTeamJoin(deps.db, {
          storeId: deps.storeId,
          scrimId: scrim.id,
          leaderTelegramId: leaderId,
          tag,
        }),
      );
    } catch (error) {
      await ctx.reply(error instanceof AppError ? error.userMessage : "صار خطأ بالتسجيل.");
      return;
    }

    if (decision.outcome === "locked") {
      await ctx.reply("التسجيل مقفل. اكتمل العدد.");
      return;
    }
    if (decision.outcome === "duplicate") {
      await ctx.reply("هالتاق مسجّل بهالسكرم.");
      return;
    }
    if (decision.outcome === "already") {
      await ctx.reply("أنت مسجّل بهالسكرم.");
      return;
    }

    if (decision.outcome === "need_proof") {
      await ctx.reply("أول مرة أو عندك سجل غياب. أرسل صورة لقروب الإيسبورت أو حسابكم للتحقق.");
      const photoCtx = await conversation.waitUntil(
        (update) => Boolean(update.message?.photo?.length) || isCancel(update),
        { otherwise: (update) => update.reply("أرسل صورة، أو /cancel.") },
      );
      if (isCancel(photoCtx)) {
        await photoCtx.reply("تم الإلغاء.");
        return;
      }
      const photo = photoCtx.message!.photo!.at(-1)!;
      try {
        const submitted = await externalApp(conversation, () =>
          submitTeamProof(deps.db, { storeId: deps.storeId, teamId: decision.teamId, photoFileId: photo.file_id }),
        );
        if ("next" in submitted) {
          await externalApp(conversation, () =>
            announceTeamRegistration(ctx.api, deps, {
              teamId: decision.teamId,
              tag: decision.tag,
              status: submitted.team.status,
              leader: { id: leaderId, username: ctx.from?.username },
              photoFileId: photo.file_id,
              needsReview: false,
            }).catch(() => "none" as const),
          );
          if (submitted.next === "waitlist") {
            await ctx.reply("تم قبولك، بس الأماكن اكتملت. تبي الاحتياط؟", {
              reply_markup: scrimWaitlistKeyboard(decision.teamId),
            });
            return;
          }
        } else if ("autoApproved" in submitted && submitted.autoApproved === false) {
          const sentTo = await externalApp(conversation, () =>
            announceTeamRegistration(ctx.api, deps, {
              teamId: decision.teamId,
              tag: decision.tag,
              status: "PENDING_PROOF",
              leader: { id: leaderId, username: ctx.from?.username },
              photoFileId: photo.file_id,
              needsReview: true,
            }),
          );
          await ctx.reply(
            sentTo === "group"
              ? "وصلت الصورة للمنظمين. أول ما تُقبل اكتب «ملتزمين»."
              : "وصلت الصورة للمالك. أول ما تُقبل اكتب «ملتزمين».",
          );
          return;
        }
      } catch (error) {
        await ctx.reply(error instanceof AppError ? error.userMessage : "ما قدرنا نحفظ الصورة.");
        return;
      }
    }

    if (decision.outcome === "need_commit" || decision.outcome === "waitlist_offer") {
      await externalApp(conversation, () =>
        announceTeamRegistration(ctx.api, deps, {
          teamId: decision.teamId,
          tag: decision.tag,
          status: decision.outcome === "need_commit" ? "WAITING_COMMIT" : "WAITLIST",
          leader: { id: leaderId, username: ctx.from?.username },
          needsReview: false,
        }).catch(() => "none" as const),
      );
    }

    if (decision.outcome === "waitlist_offer") {
      await ctx.reply("الأماكن اكتملت. تبي تدخل قائمة الانتظار (احتياط)؟", {
        reply_markup: scrimWaitlistKeyboard(decision.teamId),
      });
      return;
    }

    const template = await externalApp(conversation, () => ensureScrimTemplate(deps.db, deps.storeId));
    await ctx.reply(`اكتب «${template.committedPhrase}» لتثبيت مقعدك. الرقم السري يوصلك بعد الالتزام فقط.`);
    const commitCtx = await conversation.waitUntil(
      (update) => Boolean(update.message?.text) || isCancel(update),
      { otherwise: (update) => update.reply(`اكتب «${template.committedPhrase}» أو /cancel.`) },
    );
    if (isCancel(commitCtx)) {
      await commitCtx.reply("تم الإلغاء.");
      return;
    }
    const phrase = commitCtx.message!.text!.trim();
    if (!isCommitPhrase(phrase, template.committedPhrase)) {
      await ctx.reply(`اكتب «${template.committedPhrase}» بالضبط بعد /start من زر التسجيل.`);
      return;
    }
    try {
      const result = await externalApp(conversation, () =>
        commitTeam(deps.db, {
          storeId: deps.storeId,
          leaderTelegramId: leaderId,
          phrase,
          scrimId: scrim.id,
        }),
      );
      if (result.waitlisted) {
        await ctx.reply("المقاعد اكتملت وأنت بالحجز الاحتياط. نرقّيك تلقائي إذا انسحب أحد.");
        return;
      }
      await ctx.reply(withDropsLink(result.ack, template.dropsGroupLink));
    } catch (error) {
      await ctx.reply(error instanceof AppError ? error.userMessage : "ما تم الالتزام.");
    }
  };
}

