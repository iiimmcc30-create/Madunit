import type { Bot } from "grammy";
import { isSuperAdmin } from "../../config";
import { AppError } from "../../domain/errors";
import { formatStandingsLines, looksLikeJoinScrim, looksLikeOpenScrim, looksLikeRoomCredentials } from "../../domain/scrim-parse";
import { isCommitPhrase, normalizeScrimTag } from "../../domain/scrim-tag";
import { extractRoomCredentialsWithLlm, readStandingsWithLlm } from "../../llm/scrim";
import {
  addScrimModerator,
  addTeamManual,
  allRoomsConfirmed,
  commitTeam,
  confirmRoomResult,
  confirmedLeaders,
  ensureScrimTemplate,
  finalizeScrim,
  findActiveScrim,
  findJoinableScrim,
  isScrimOperator,
  joinWaitlist,
  lockScrimManual,
  markLockPublished,
  markRoomPublished,
  markRosterPublished,
  markTeamNoShow,
  nextUnconfirmedRoom,
  nextUnpublishedRoom,
  parseScrimRoomResult,
  proposeRoomResult,
  publishScrimOpen,
  rankingForScrim,
  removeScrimModerator,
  renderLockCaption,
  renderOpenCaption,
  renderRoomIdCaption,
  renderRoomIdPublicCaption,
  scheduleRoomChannelPost,
  renderRoomResultCaption,
  renderRosterCaption,
  saveRosterDraft,
  setRoomCredentials,
  cancelScrimDraft,
  withdrawTeam,
} from "../../services/scrim";
import { formatRanking } from "../../domain/scrim-score";
import { botDeepLink, scrimStartPayload } from "../../domain/start-payload";
import type { BotContext } from "../context";
import type { AppDeps } from "../deps";
import {
  scrimRegisterKeyboard,
  scrimResultKeyboard,
  scrimRosterKeyboard,
} from "../keyboards";
import { texts } from "../texts";
import { withDropsLink } from "../../domain/scrim-group";
import { applyTeamReview, isScrimGroupChat, scrimActorLabel } from "./scrim-review";
import { afterScrimOpened } from "./scrim-publish";
import { resolveRoomIdMode, roomChannelPostAt } from "../../domain/scrim-room-post";
import { formatRiyadhTime } from "../../domain/scrim-time";

function actorId(ctx: BotContext): string {
  return String(ctx.from?.id ?? "");
}

async function requireOperator(deps: AppDeps, telegramId: string) {
  const store = await deps.stores.getById(deps.storeId);
  const template = await ensureScrimTemplate(deps.db, deps.storeId);
  if (!isScrimOperator(store.ownerTelegramId, telegramId, deps.config.superAdminTelegramId, template.moderatorTelegramIds)) {
    return null;
  }
  return { store, template };
}

async function notifyConfirmed(ctx: BotContext, scrim: Parameters<typeof confirmedLeaders>[0], text: string) {
  for (const leader of confirmedLeaders(scrim)) {
    if (!/^\d+$/.test(leader.telegramId)) continue;
    try {
      await ctx.api.sendMessage(leader.telegramId, text);
    } catch {
      // player may have blocked the bot
    }
  }
}

async function publishLockAndRoster(
  ctx: BotContext,
  deps: AppDeps,
  store: { channelId: string | null; ownerTelegramId: string },
  template: Awaited<ReturnType<typeof ensureScrimTemplate>>,
  scrim: Awaited<ReturnType<typeof findJoinableScrim>>,
  lockCaption: string,
) {
  if (!scrim) return;
  if (store.channelId) {
    const lockMsg = await ctx.api.sendMessage(store.channelId, lockCaption);
    await markLockPublished(deps.db, deps.storeId, scrim.id, String(lockMsg.message_id));
  }
  const roster = renderRosterCaption(template, await findJoinableScrim(deps.db, deps.storeId, scrim.id) ?? scrim);
  await saveRosterDraft(deps.db, deps.storeId, scrim.id, roster);
  await ctx.api.sendMessage(store.ownerTelegramId, `راجع اللستة قبل النشر:\n\n${roster}`, {
    reply_markup: scrimRosterKeyboard(scrim.id),
  });
}

export function registerScrimHandlers(bot: Bot<BotContext>, deps: AppDeps) {
  bot.command("scrim", async (ctx) => {
    const allowed = await requireOperator(deps, actorId(ctx));
    if (!allowed) {
      await ctx.reply(texts.notOwner);
      return;
    }
    const payload = typeof ctx.match === "string" ? ctx.match.trim() : "";
    await ctx.conversation.enter("openScrim", { text: payload });
  });

  bot.command("scrim_lock", async (ctx) => {
    const allowed = await requireOperator(deps, actorId(ctx));
    if (!allowed) {
      await ctx.reply(texts.notOwner);
      return;
    }
    const scrim = await findActiveScrim(deps.db, deps.storeId);
    if (!scrim || scrim.status !== "OPEN") {
      await ctx.reply("ما فيه تسجيل مفتوح.");
      return;
    }
    try {
      const locked = await lockScrimManual(deps.db, deps.storeId, scrim.id);
      await ctx.reply("تم قفل التسجيل.");
      await publishLockAndRoster(ctx, deps, allowed.store, allowed.template, locked.scrim, locked.lockCaption);
    } catch (error) {
      await ctx.reply(error instanceof AppError ? error.userMessage : "ما قدرنا نقفّل.");
    }
  });

  bot.command("scrim_list", async (ctx) => {
    const allowed = await requireOperator(deps, actorId(ctx));
    if (!allowed) {
      await ctx.reply(texts.notOwner);
      return;
    }
    const scrim = await findActiveScrim(deps.db, deps.storeId);
    if (!scrim) {
      await ctx.reply("ما فيه سكرم جاري.");
      return;
    }
    const roster = renderRosterCaption(allowed.template, scrim);
    await ctx.reply(roster || "اللستة فاضية.", { reply_markup: scrimRosterKeyboard(scrim.id) });
  });

  bot.command("scrim_add", async (ctx) => {
    const allowed = await requireOperator(deps, actorId(ctx));
    if (!allowed) {
      await ctx.reply(texts.notOwner);
      return;
    }
    const tag = (typeof ctx.match === "string" ? ctx.match : "").trim();
    const scrim = await findActiveScrim(deps.db, deps.storeId);
    if (!scrim) {
      await ctx.reply("ما فيه سكرم جاري.");
      return;
    }
    if (!tag) {
      ctx.session.pendingScrimAddTeam = scrim.id;
      await ctx.reply("أرسل تاق الفريق لإضافته يدوي.");
      return;
    }
    try {
      await addTeamManual(deps.db, { storeId: deps.storeId, scrimId: scrim.id, tag });
      await ctx.reply(`تمت إضافة ${normalizeScrimTag(tag)}.`);
    } catch (error) {
      await ctx.reply(error instanceof AppError ? error.userMessage : "ما تمت الإضافة.");
    }
  });

  bot.command("scrim_remove", async (ctx) => {
    const allowed = await requireOperator(deps, actorId(ctx));
    if (!allowed) {
      await ctx.reply(texts.notOwner);
      return;
    }
    const tag = (typeof ctx.match === "string" ? ctx.match : "").trim();
    const scrim = await findActiveScrim(deps.db, deps.storeId);
    if (!scrim) {
      await ctx.reply("ما فيه سكرم جاري.");
      return;
    }
    if (!tag) {
      ctx.session.pendingScrimRemoveTeam = scrim.id;
      await ctx.reply("أرسل تاق الفريق لشطبه.");
      return;
    }
    try {
      const result = await withdrawTeam(deps.db, { storeId: deps.storeId, scrimId: scrim.id, tagOrId: tag });
      if (result.promoted) {
        try {
          await ctx.api.sendMessage(result.promoted.leaderTelegramId, `ترقيت من الاحتياط. اكتب «ملتزمين» لتثبيت ${result.promoted.tag}.`);
        } catch {
          // ignore
        }
      }
      await ctx.reply("تم شطب الفريق.");
    } catch (error) {
      await ctx.reply(error instanceof AppError ? error.userMessage : "ما تم الشطب.");
    }
  });

  bot.command("scrim_noshow", async (ctx) => {
    const allowed = await requireOperator(deps, actorId(ctx));
    if (!allowed) {
      await ctx.reply(texts.notOwner);
      return;
    }
    const tag = (typeof ctx.match === "string" ? ctx.match : "").trim();
    const scrim = await findActiveScrim(deps.db, deps.storeId);
    if (!scrim || !tag) {
      await ctx.reply("استخدم: /scrim_noshow TAG");
      return;
    }
    try {
      await markTeamNoShow(deps.db, { storeId: deps.storeId, scrimId: scrim.id, tag });
      await ctx.reply("تم تعليم الفريق غائب، ونزل مستوى الثقة.");
    } catch (error) {
      await ctx.reply(error instanceof AppError ? error.userMessage : "ما تم التعليم.");
    }
  });

  bot.command("scrim_done", async (ctx) => {
    const allowed = await requireOperator(deps, actorId(ctx));
    if (!allowed) {
      await ctx.reply(texts.notOwner);
      return;
    }
    const scrim = await findActiveScrim(deps.db, deps.storeId);
    if (!scrim) {
      await ctx.reply("ما فيه سكرم جاري.");
      return;
    }
    try {
      const done = await finalizeScrim(deps.db, deps.storeId, scrim.id);
      if (allowed.store.channelId) {
        await ctx.api.sendMessage(allowed.store.channelId, done.caption);
      }
      await notifyConfirmed(ctx, scrim, allowed.template.thanksText);
      await ctx.reply("تم ختام السكرم وتحديث سجل الفرق.");
    } catch (error) {
      await ctx.reply(error instanceof AppError ? error.userMessage : "ما تم الختام.");
    }
  });

  bot.command("scrim_mod", async (ctx) => {
    const store = await deps.stores.getById(deps.storeId);
    const actor = actorId(ctx);
    if (!isSuperAdmin(deps.config, actor) && actor !== store.ownerTelegramId) {
      await ctx.reply(texts.notOwner);
      return;
    }
    const raw = (typeof ctx.match === "string" ? ctx.match : "").trim();
    const add = raw.match(/^(?:add\s+)?(\d{3,20})$/i);
    const remove = raw.match(/^remove\s+(\d{3,20})$/i);
    try {
      if (remove) {
        await removeScrimModerator(deps.db, deps.storeId, remove[1]);
        await ctx.reply("تشال المشرف.");
        return;
      }
      if (add) {
        await addScrimModerator(deps.db, deps.storeId, add[1]);
        await ctx.reply("انضاف مشرف سكرم.");
        return;
      }
      await ctx.reply("استخدم: /scrim_mod 123456789 أو /scrim_mod remove 123456789");
    } catch (error) {
      await ctx.reply(error instanceof AppError ? error.userMessage : "ما تم التعديل.");
    }
  });

  bot.callbackQuery(/^sc:open:/, async (ctx) => {
    const allowed = await requireOperator(deps, actorId(ctx));
    if (!allowed) {
      await ctx.answerCallbackQuery({ text: "للمالك فقط" });
      return;
    }
    const scrimId = ctx.callbackQuery.data.slice("sc:open:".length);
    const channelId = allowed.store.channelId;
    if (!channelId) {
      await ctx.answerCallbackQuery();
      await ctx.reply("اربط القناة أو المجموعة أول: /setup في بوت المتجر بالخاص، أو /bind داخل المجموعة.");
      return;
    }
    if (!deps.botUsername) {
      await ctx.answerCallbackQuery();
      await ctx.reply("يوزر البوت غير معروف.");
      return;
    }
    try {
      const draft = await findJoinableScrim(deps.db, deps.storeId, scrimId);
      if (!draft || draft.status !== "DRAFT") {
        await ctx.answerCallbackQuery({ text: "مو مسودة" });
        return;
      }
      const caption = renderOpenCaption(allowed.template, draft);
      const markup = scrimRegisterKeyboard(deps.botUsername, draft.id);
      const sent = allowed.template.openPhotoFileId
        ? await ctx.api.sendPhoto(channelId, allowed.template.openPhotoFileId, {
            caption: caption.slice(0, 1024),
            reply_markup: markup,
          })
        : await ctx.api.sendMessage(channelId, caption, { reply_markup: markup });
      const opened = await publishScrimOpen(deps.db, {
        storeId: deps.storeId,
        scrimId: draft.id,
        channelMessageId: String(sent.message_id),
      });
      await afterScrimOpened(ctx.api, allowed.template, opened, channelId);
      await ctx.answerCallbackQuery({ text: "نُشر" });
      await ctx.reply(`انفتح التسجيل.\n${botDeepLink(deps.botUsername, scrimStartPayload(draft.id))}`);
    } catch (error) {
      await ctx.answerCallbackQuery();
      await ctx.reply(error instanceof AppError ? error.userMessage : "ما نُشر الإعلان.");
    }
  });

  bot.callbackQuery(/^sc:nop:/, async (ctx) => {
    const allowed = await requireOperator(deps, actorId(ctx));
    if (!allowed) {
      await ctx.answerCallbackQuery({ text: "للمالك فقط" });
      return;
    }
    const scrimId = ctx.callbackQuery.data.slice("sc:nop:".length);
    try {
      await cancelScrimDraft(deps.db, deps.storeId, scrimId);
      await ctx.answerCallbackQuery({ text: "ألغينا" });
      await ctx.reply("ألغينا مسودة السكرم.");
    } catch (error) {
      await ctx.answerCallbackQuery();
      await ctx.reply(error instanceof AppError ? error.userMessage : "ما ألغي.");
    }
  });

  bot.callbackQuery(/^sc:(ok|no):/, async (ctx) => {
    const allowed = await requireOperator(deps, actorId(ctx));
    if (!allowed) {
      await ctx.answerCallbackQuery({ text: "للمالك فقط" });
      return;
    }
    const match = ctx.callbackQuery.data.match(/^sc:(ok|no):(.+)$/);
    if (!match) {
      await ctx.answerCallbackQuery();
      return;
    }
    try {
      const accept = match[1] === "ok";
      await applyTeamReview(ctx.api, deps, { teamId: match[2], accept, actorTelegramId: actorId(ctx) });
      await ctx.answerCallbackQuery({ text: accept ? "مقبول" : "مرفوض" });
      try {
        await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
      } catch {
        // ignore
      }
      if (isScrimGroupChat(ctx) && ctx.callbackQuery.message) {
        const by = scrimActorLabel(ctx);
        await ctx.reply(accept ? texts.scrimGroupApproved(by) : texts.scrimGroupRejected(by), {
          reply_parameters: { message_id: ctx.callbackQuery.message.message_id },
        });
      }
    } catch (error) {
      await ctx.answerCallbackQuery();
      await ctx.reply(error instanceof AppError ? error.userMessage : "ما تمت المراجعة.");
    }
  });

  bot.callbackQuery(/^sc:wl:/, async (ctx) => {
    const teamId = ctx.callbackQuery.data.slice("sc:wl:".length);
    try {
      await joinWaitlist(deps.db, {
        storeId: deps.storeId,
        teamId,
        leaderTelegramId: actorId(ctx),
      });
      await ctx.answerCallbackQuery({ text: "احتياط" });
      await ctx.reply("تم. أنت بالاحتياط، نرقّيك تلقائي إذا انسحب أحد.");
    } catch (error) {
      await ctx.answerCallbackQuery();
      await ctx.reply(error instanceof AppError ? error.userMessage : "ما تم الحجز.");
    }
  });

  bot.callbackQuery(/^sc:rpub:/, async (ctx) => {
    const allowed = await requireOperator(deps, actorId(ctx));
    if (!allowed || !allowed.store.channelId) {
      await ctx.answerCallbackQuery({ text: "اربط القناة/المجموعة" });
      return;
    }
    const scrimId = ctx.callbackQuery.data.slice("sc:rpub:".length);
    const scrim = await findJoinableScrim(deps.db, deps.storeId, scrimId);
    if (!scrim) {
      await ctx.answerCallbackQuery();
      return;
    }
    const text = scrim.rosterDraft || renderRosterCaption(allowed.template, scrim);
    const sent = await ctx.api.sendMessage(allowed.store.channelId, text);
    await markRosterPublished(deps.db, deps.storeId, scrim.id, String(sent.message_id));
    await ctx.answerCallbackQuery({ text: "نُشرت اللستة" });
  });

  bot.callbackQuery(/^sc:redit:/, async (ctx) => {
    const allowed = await requireOperator(deps, actorId(ctx));
    if (!allowed) {
      await ctx.answerCallbackQuery({ text: "للمالك فقط" });
      return;
    }
    const scrimId = ctx.callbackQuery.data.slice("sc:redit:".length);
    ctx.session.pendingScrimRosterEdit = scrimId;
    await ctx.answerCallbackQuery();
    await ctx.reply("أرسل نص اللستة المعدّل، أو /scrim_add TAG و /scrim_remove TAG ثم اضغط نشر.");
  });

  bot.callbackQuery(/^sc:rok:/, async (ctx) => {
    const allowed = await requireOperator(deps, actorId(ctx));
    if (!allowed) {
      await ctx.answerCallbackQuery({ text: "للمالك فقط" });
      return;
    }
    const roomId = ctx.callbackQuery.data.slice("sc:rok:".length);
    try {
      const confirmed = await confirmRoomResult(deps.db, { storeId: deps.storeId, roomId });
      const caption = renderRoomResultCaption(allowed.template, confirmed.room.index, confirmed.result, confirmed.scrim.maps);
      if (allowed.store.channelId) {
        if (confirmed.room.resultPhotoFileId) {
          await ctx.api.sendPhoto(allowed.store.channelId, confirmed.room.resultPhotoFileId, {
            caption: caption.slice(0, 1024),
          });
        } else {
          await ctx.api.sendMessage(allowed.store.channelId, caption);
        }
      }
      await ctx.answerCallbackQuery({ text: "نُشرت النتائج" });
      const scrim = await findJoinableScrim(deps.db, deps.storeId, confirmed.scrim.id);
      if (scrim && allRoomsConfirmed(scrim)) {
        const scores = await rankingForScrim(deps.db, deps.storeId, scrim.id);
        await ctx.reply(`هذا الترتيب التراكمي:\n${formatRanking(scores)}\n\nإذا هذا آخر روم استخدم /scrim_done`);
      }
    } catch (error) {
      await ctx.answerCallbackQuery();
      await ctx.reply(error instanceof AppError ? error.userMessage : "ما نُشر بدون تأكيد صحيح.");
    }
  });

  bot.callbackQuery(/^sc:rno:/, async (ctx) => {
    const allowed = await requireOperator(deps, actorId(ctx));
    if (!allowed) {
      await ctx.answerCallbackQuery({ text: "للمالك فقط" });
      return;
    }
    ctx.session.pendingScrimResultEdit = ctx.callbackQuery.data.slice("sc:rno:".length);
    await ctx.answerCallbackQuery();
    await ctx.reply(
      "أرسل النتائج نصًا JSON أو أسطر مثل:\n1 AAA 12\n2 BBB 8\nولا ننشر أرقام من عندنا.",
    );
  });

  bot.on("message:photo", async (ctx, next) => {
    if (ctx.chat.type !== "private") {
      await next();
      return;
    }
    const allowed = await requireOperator(deps, actorId(ctx));
    if (!allowed) {
      await next();
      return;
    }
    const photo = ctx.message.photo.at(-1);
    if (!photo) {
      await next();
      return;
    }
    const scrim = await findActiveScrim(deps.db, deps.storeId);
    if (!scrim || (scrim.status !== "LIVE" && scrim.status !== "LOCKED" && scrim.status !== "OPEN")) {
      await next();
      return;
    }
    const room = nextUnconfirmedRoom(scrim) ?? nextUnpublishedRoom(scrim);
    if (!room || !room.publishedAt) {
      await next();
      return;
    }
    const fileUrl = await deps.telegramFileUrl(photo.file_id);
    const parsed = fileUrl ? await readStandingsWithLlm(deps.llm, fileUrl) : parseScrimRoomResult(null);
    if (!parsed) {
      ctx.session.pendingScrimResultEdit = room.id;
      await ctx.reply(
        "ما قدرت أقرأ المراكز من الصورة بدون تخمين. أرسل ترتيب أول 5 كنص:\n1 TAG 12\n2 TAG 8",
      );
      return;
    }
    await proposeRoomResult(deps.db, {
      storeId: deps.storeId,
      roomId: room.id,
      photoFileId: photo.file_id,
      parsed,
    });
    await ctx.reply(
      `هذا اللي قرأته — أكّد قبل النشر:\n${formatStandingsLines(parsed)}\nأكثر كيلات: ${parsed.topKiller?.name ?? "—"} (${parsed.topKiller?.kills ?? "—"})`,
      { reply_markup: scrimResultKeyboard(room.id) },
    );
  });

  bot.on("message:text", async (ctx, next) => {
    if (ctx.chat.type !== "private") {
      await next();
      return;
    }
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) {
      await next();
      return;
    }

    if (ctx.session.pendingScrimRosterEdit) {
      const allowed = await requireOperator(deps, actorId(ctx));
      if (!allowed) {
        await next();
        return;
      }
      const scrimId = ctx.session.pendingScrimRosterEdit;
      ctx.session.pendingScrimRosterEdit = undefined;
      await saveRosterDraft(deps.db, deps.storeId, scrimId, text);
      await ctx.reply("حفظنا النص. راجع وانشر.", { reply_markup: scrimRosterKeyboard(scrimId) });
      return;
    }

    if (ctx.session.pendingScrimAddTeam) {
      const scrimId = ctx.session.pendingScrimAddTeam;
      ctx.session.pendingScrimAddTeam = undefined;
      try {
        await addTeamManual(deps.db, { storeId: deps.storeId, scrimId, tag: text });
        await ctx.reply("تمت الإضافة.");
      } catch (error) {
        await ctx.reply(error instanceof AppError ? error.userMessage : "ما تمت الإضافة.");
      }
      return;
    }

    if (ctx.session.pendingScrimRemoveTeam) {
      const scrimId = ctx.session.pendingScrimRemoveTeam;
      ctx.session.pendingScrimRemoveTeam = undefined;
      try {
        await withdrawTeam(deps.db, { storeId: deps.storeId, scrimId, tagOrId: text });
        await ctx.reply("تم الشطب.");
      } catch (error) {
        await ctx.reply(error instanceof AppError ? error.userMessage : "ما تم الشطب.");
      }
      return;
    }

    if (ctx.session.pendingScrimResultEdit) {
      const roomId = ctx.session.pendingScrimResultEdit;
      const rows = text
        .split("\n")
        .map((line) => line.trim().match(/^(\d+)\s+([A-Za-z0-9_\p{L}]+)\s+(\d+)$/u))
        .filter((match): match is RegExpMatchArray => Boolean(match))
        .map((match) => ({
          place: Number(match[1]),
          tag: normalizeScrimTag(match[2]) ?? "",
          kills: Number(match[3]),
        }))
        .filter((row) => row.tag && row.place >= 1 && row.place <= 5);
      const parsed = parseScrimRoomResult({ rows });
      if (!parsed) {
        await ctx.reply("ما فهمت الأسطر. مثال: 1 AAA 12");
        return;
      }
      await proposeRoomResult(deps.db, {
        storeId: deps.storeId,
        roomId,
        photoFileId: "",
        parsed,
      });
      ctx.session.pendingScrimResultEdit = undefined;
      await ctx.reply(`للتأكيد:\n${formatStandingsLines(parsed)}`, {
        reply_markup: scrimResultKeyboard(roomId),
      });
      return;
    }

    const template = await ensureScrimTemplate(deps.db, deps.storeId);
    if (isCommitPhrase(text, template.committedPhrase)) {
      try {
        const result = await commitTeam(deps.db, {
          storeId: deps.storeId,
          leaderTelegramId: actorId(ctx),
          phrase: text,
        });
        if (result.waitlisted) {
          await ctx.reply("المقاعد مكتملة، أنت بالاحتياط.");
          return;
        }
        await ctx.reply(withDropsLink(result.ack, template.dropsGroupLink));
        if ("lock" in result && result.lock.locked) {
          const store = await deps.stores.getById(deps.storeId);
          await publishLockAndRoster(
            ctx,
            deps,
            store,
            template,
            result.scrim,
            result.lock.lockCaption ?? renderLockCaption(template, result.scrim.maxTeams),
          );
        }
        return;
      } catch (error) {
        if (error instanceof AppError && error.code === "NOT_FOUND") {
          await next();
          return;
        }
        await ctx.reply(error instanceof AppError ? error.userMessage : "ما تم الالتزام.");
        return;
      }
    }

    const allowed = await requireOperator(deps, actorId(ctx));
    if (allowed && looksLikeOpenScrim(text)) {
      await ctx.conversation.enter("openScrim", { text });
      return;
    }

    if (allowed && looksLikeRoomCredentials(text)) {
      const scrim = await findActiveScrim(deps.db, deps.storeId);
      if (!scrim) {
        await next();
        return;
      }
      const creds = await extractRoomCredentialsWithLlm(deps.llm, text);
      if (!creds) {
        await ctx.reply("أرسل آيدي الروم والباسورد مع بعض.");
        return;
      }
      try {
        const updated = await setRoomCredentials(deps.db, {
          storeId: deps.storeId,
          scrimId: scrim.id,
          creds,
        });
        const caption = renderRoomIdCaption(allowed.template, creds, { index: updated.room.index, maps: updated.scrim.maps });
        const mode = resolveRoomIdMode(allowed.template);
        let scheduledNote = "";
        if (allowed.store.channelId) {
          if (mode === "id_only") {
            const at = roomChannelPostAt(
              { roomIndex: updated.room.index, startsAt: updated.scrim.startsAt, leadMinutes: allowed.template.roomIdLeadMinutes },
              new Date(),
            );
            if (!at) {
              await ctx.api.sendMessage(
                allowed.store.channelId,
                renderRoomIdPublicCaption(allowed.template, creds, { index: updated.room.index, maps: updated.scrim.maps }),
              );
            } else {
              scheduledNote = `\nالآيدي بينزل بالقناة الساعة ${formatRiyadhTime(at)} (قبل البداية بـ ${allowed.template.roomIdLeadMinutes} دقايق) بدون الباس.`;
            }
            await scheduleRoomChannelPost(deps.db, updated.room.id, at);
          } else {
            await ctx.api.sendMessage(
              allowed.store.channelId,
              mode === "full" ? caption : texts.scrimRoomChannelNotice(updated.room.index),
            );
          }
        }
        await notifyConfirmed(ctx, updated.scrim, withDropsLink(caption, allowed.template.dropsGroupLink));
        await markRoomPublished(deps.db, deps.storeId, updated.room.id);
        await ctx.reply(`نُشر آيدي الروم ${updated.room.index} للفرق الملتزمة.${scheduledNote}`);
      } catch (error) {
        await ctx.reply(error instanceof AppError ? error.userMessage : "ما نُشر الآيدي.");
      }
      return;
    }

    if (looksLikeJoinScrim(text)) {
      await ctx.conversation.enter("registerScrim");
      return;
    }

    await next();
  });
}
