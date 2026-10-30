import type { Api, Bot } from "grammy";
import { AppError } from "../../domain/errors";
import {
  applyDropClaim,
  formatTeamDrops,
  MAP_LABEL,
  parseDropClaim,
  spotName,
} from "../../domain/scrim-drops";
import { withDropsLink } from "../../domain/scrim-group";
import { dueScheduledOpen, dueScrimActions, parseScheduleCommand } from "../../domain/scrim-schedule";
import { normalizeScrimTag } from "../../domain/scrim-tag";
import { formatRiyadhTime } from "../../domain/scrim-time";
import { kindLabel } from "../../domain/scrim-types";
import { createMemoryDropsStore, createRedisDropsStore, type DropsStore } from "../../services/scrim-drops-store";
import {
  createScrimDraft,
  ensureScrimTemplate,
  findActiveScrim,
  isScrimOperator,
  publishScrimOpen,
  renderOpenCaption,
  renderRoomIdCaption,
  renderRoomIdPublicCaption,
  markRoomChannelPosted,
  updateScrimTemplate,
  type ScrimWithRelations,
} from "../../services/scrim";
import type { BotContext } from "../context";
import type { AppDeps } from "../deps";
import { scrimRegisterKeyboard } from "../keyboards";
import { afterScrimOpened } from "./scrim-publish";
import { texts } from "../texts";

const dropsStores = new Map<string, DropsStore>();

export function dropsStoreFor(deps: Pick<AppDeps, "storeId" | "redis">): DropsStore {
  let store = dropsStores.get(deps.storeId);
  if (!store) {
    store = deps.redis ? createRedisDropsStore(deps.redis, deps.storeId) : createMemoryDropsStore();
    dropsStores.set(deps.storeId, store);
  }
  return store;
}

function dropsTtlSeconds(scrim: Pick<ScrimWithRelations, "startsAt">, now = new Date()): number {
  const end = (scrim.startsAt?.getTime() ?? now.getTime()) + 6 * 3_600_000;
  return Math.max(3600, (end - now.getTime()) / 1000);
}

function isGroup(ctx: BotContext): boolean {
  return ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
}

async function isOperator(deps: AppDeps, telegramId: string) {
  const store = await deps.stores.getById(deps.storeId);
  const template = await ensureScrimTemplate(deps.db, deps.storeId);
  return isScrimOperator(store.ownerTelegramId, telegramId, deps.config.superAdminTelegramId, template.moderatorTelegramIds);
}

export async function setDropsGroupOpen(api: Api, chatId: string, open: boolean) {
  await api.setChatPermissions(chatId, { can_send_messages: open });
}

function confirmedTeams(scrim: ScrimWithRelations) {
  return scrim.teams.filter((team) => team.status === "CONFIRMED");
}

async function dmConfirmed(api: Api, scrim: ScrimWithRelations, build: (team: ScrimWithRelations["teams"][number]) => Promise<string> | string) {
  for (const team of confirmedTeams(scrim)) {
    if (!/^\d+$/.test(team.leaderTelegramId)) continue;
    try {
      await api.sendMessage(team.leaderTelegramId, await build(team));
    } catch {
      // player may have blocked the bot
    }
  }
}

/** One scheduler tick for this store: scheduled opening, drops lock/unlock, reminders. */
export function makeScrimTick(api: Api, deps: AppDeps) {
  return async function tick(now: Date) {
    const template = await ensureScrimTemplate(deps.db, deps.storeId);

    const due = dueScheduledOpen(template, now);
    if (due) {
      await updateScrimTemplate(deps.db, deps.storeId, { scheduleLastRunKey: due.key });
      const existing = await findActiveScrim(deps.db, deps.storeId);
      const store = await deps.stores.getById(deps.storeId);
      if (existing && existing.status !== "DRAFT") {
        deps.logger.info({ storeId: deps.storeId }, "scheduled scrim skipped; another scrim is active");
      } else if (!store.channelId || !deps.botUsername) {
        await api.sendMessage(store.ownerTelegramId, texts.scrimScheduleNoChannel).catch(() => undefined);
      } else {
        const draft = await createScrimDraft(deps.db, {
          storeId: deps.storeId,
          openedByTelegramId: "schedule",
          kind: (template.scheduleKind ?? "GULF") as "GULF" | "EUROPE",
          scheduledAtLabel: `${template.scheduleTime} (بتوقيت السعودية)`,
          maxTeams: Math.min(25, Math.max(2, template.scheduleMaxTeams)),
          roomCount: Math.min(6, Math.max(1, template.scheduleRoomCount)),
          roomSecret: "",
          startsAt: due.startsAt,
        });
        const caption = renderOpenCaption(template, draft);
        const markup = scrimRegisterKeyboard(deps.botUsername, draft.id);
        const sent = template.openPhotoFileId
          ? await api.sendPhoto(store.channelId, template.openPhotoFileId, { caption: caption.slice(0, 1024), reply_markup: markup })
          : await api.sendMessage(store.channelId, caption, { reply_markup: markup });
        const opened = await publishScrimOpen(deps.db, { storeId: deps.storeId, scrimId: draft.id, channelMessageId: String(sent.message_id) });
        await afterScrimOpened(api, template, opened, store.channelId);
        await api
          .sendMessage(store.ownerTelegramId, texts.scrimScheduleOpened(kindLabel(draft.kind), formatRiyadhTime(due.startsAt)))
          .catch(() => undefined);
      }
    }

    const scrim = await findActiveScrim(deps.db, deps.storeId);
    if (!scrim || scrim.status === "DRAFT") return;

    // scheduled public room Id posts (id_only mode)
    const store = await deps.stores.getById(deps.storeId);
    for (const room of scrim.rooms) {
      if (!room.channelPostAt || room.channelPostedAt || !room.roomTelegramId) continue;
      if (room.channelPostAt.getTime() > now.getTime()) continue;
      try {
        await markRoomChannelPosted(deps.db, room.id);
        if (store.channelId) {
          await api.sendMessage(
            store.channelId,
            renderRoomIdPublicCaption(template, { roomId: room.roomTelegramId, password: "" }, { index: room.index, maps: scrim.maps }),
          );
        }
      } catch (error) {
        deps.logger.warn({ storeId: deps.storeId, err: error instanceof Error ? error.message : String(error) }, "room id channel post failed");
      }
    }
    const actions = dueScrimActions(scrim, template, now);
    for (const action of actions) {
      try {
        if (action === "unlockDrops" && template.dropsGroupId) {
          await setDropsGroupOpen(api, template.dropsGroupId, true);
          await api.sendMessage(template.dropsGroupId, texts.scrimDropsOpened).catch(() => undefined);
          await deps.db.scrim.update({ where: { id: scrim.id }, data: { dropsUnlockedAt: now } });
        }
        if (action === "lockDrops" && template.dropsGroupId) {
          await setDropsGroupOpen(api, template.dropsGroupId, false);
          await api.sendMessage(template.dropsGroupId, texts.scrimDropsClosed).catch(() => undefined);
          await deps.db.scrim.update({ where: { id: scrim.id }, data: { dropsLockedAt: now } });
        }
        if (action === "skip30") {
          await deps.db.scrim.update({ where: { id: scrim.id }, data: { remind30At: now } });
        }
        if (action === "remind30") {
          await deps.db.scrim.update({ where: { id: scrim.id }, data: { remind30At: now } });
          await dmConfirmed(api, scrim, () => withDropsLink(texts.scrimRemind30(scrim.scheduledAtLabel), template.dropsGroupLink));
        }
        if (action === "remind5") {
          await deps.db.scrim.update({ where: { id: scrim.id }, data: { remind5At: now } });
          const drops = await dropsStoreFor(deps).get(scrim.id);
          const room = [...scrim.rooms]
            .filter((row) => row.roomTelegramId)
            .sort((a, b) => b.index - a.index)[0];
          const creds = room ? renderRoomIdCaption(template, { roomId: room.roomTelegramId, password: room.roomPassword }, { index: room.index, maps: scrim.maps }) : "";
          await dmConfirmed(api, scrim, (team) =>
            withDropsLink(texts.scrimRemind5({ creds, drops: formatTeamDrops(drops.teams[team.tag]) }), template.dropsGroupLink),
          );
        }
      } catch (error) {
        deps.logger.warn({ storeId: deps.storeId, action, err: error instanceof Error ? error.message : String(error) }, "scrim timer action failed");
      }
    }
  };
}

export function registerScrimDropsHandlers(bot: Bot<BotContext>, deps: AppDeps) {
  bot.command("scrim_drops_group", async (ctx) => {
    const actor = String(ctx.from?.id ?? "");
    if (!(await isOperator(deps, actor))) {
      if (!isGroup(ctx)) await ctx.reply(texts.notOwner);
      return;
    }
    const arg = (typeof ctx.match === "string" ? ctx.match : "").trim();
    if (/^(off|حذف|الغاء|إلغاء)$/i.test(arg)) {
      await updateScrimTemplate(deps.db, deps.storeId, { dropsGroupId: null });
      await ctx.reply(texts.scrimDropsGroupCleared);
      return;
    }
    if (!isGroup(ctx) || !ctx.chat) {
      await ctx.reply(texts.scrimDropsGroupOnlyInGroup);
      return;
    }
    try {
      const me = await ctx.api.getChatMember(ctx.chat.id, ctx.me.id);
      if (me.status !== "administrator" && me.status !== "creator") throw new Error("not admin");
      await setDropsGroupOpen(ctx.api, String(ctx.chat.id), false);
    } catch {
      await ctx.reply(texts.scrimDropsGroupNeedAdmin);
      return;
    }
    const template = await updateScrimTemplate(deps.db, deps.storeId, { dropsGroupId: String(ctx.chat.id) });
    await ctx.reply(texts.scrimDropsGroupSaved(template.dropsUnlockLeadMinutes));
  });

  bot.command("scrim_schedule", async (ctx) => {
    const actor = String(ctx.from?.id ?? "");
    if (!(await isOperator(deps, actor))) {
      await ctx.reply(texts.notOwner);
      return;
    }
    const arg = (typeof ctx.match === "string" ? ctx.match : "").trim();
    if (!arg) {
      const t = await ensureScrimTemplate(deps.db, deps.storeId);
      await ctx.reply(
        t.scheduleEnabled && t.scheduleTime && t.scheduleKind
          ? texts.scrimScheduleShow({
              time: t.scheduleTime,
              kind: kindLabel(t.scheduleKind),
              maxTeams: t.scheduleMaxTeams,
              rooms: t.scheduleRoomCount,
              lead: t.scheduleOpenLeadMinutes,
            })
          : texts.scrimScheduleHelp,
      );
      return;
    }
    if (/^(off|حذف|الغاء|إلغاء|وقف)$/i.test(arg)) {
      await updateScrimTemplate(deps.db, deps.storeId, { scheduleEnabled: false });
      await ctx.reply(texts.scrimScheduleOff);
      return;
    }
    const parsed = parseScheduleCommand(arg);
    if (!parsed) {
      await ctx.reply(texts.scrimScheduleHelp);
      return;
    }
    const t = await updateScrimTemplate(deps.db, deps.storeId, {
      scheduleEnabled: true,
      scheduleTime: parsed.time,
      scheduleKind: parsed.kind,
      scheduleMaxTeams: parsed.maxTeams,
      scheduleRoomCount: parsed.roomCount,
      ...(parsed.openLeadMinutes !== undefined ? { scheduleOpenLeadMinutes: parsed.openLeadMinutes } : {}),
    });
    await ctx.reply(
      texts.scrimScheduleShow({
        time: parsed.time,
        kind: kindLabel(parsed.kind),
        maxTeams: parsed.maxTeams,
        rooms: parsed.roomCount,
        lead: t.scheduleOpenLeadMinutes,
      }),
    );
  });

  bot.on("message:text", async (ctx, next) => {
    if (!isGroup(ctx)) {
      await next();
      return;
    }
    const template = await ensureScrimTemplate(deps.db, deps.storeId);
    if (!template.dropsGroupId || template.dropsGroupId !== String(ctx.chat.id)) {
      await next();
      return;
    }
    const parsed = parseDropClaim(ctx.message.text);
    if (!parsed) return; // ordinary chatter in the drops group is ignored
    const replyTo = { reply_parameters: { message_id: ctx.message.message_id } };
    if (!parsed.ok) {
      await ctx.reply(texts.scrimDropsRange, replyTo);
      return;
    }
    const scrim = await findActiveScrim(deps.db, deps.storeId);
    if (!scrim || scrim.status === "DRAFT") {
      await ctx.reply(texts.scrimDropsNoScrim, replyTo);
      return;
    }
    const tag = normalizeScrimTag(parsed.claim.team);
    const sender = String(ctx.from?.id ?? "");
    const confirmed = confirmedTeams(scrim);
    const team =
      (tag ? confirmed.find((row) => row.tag === tag) : undefined) ?? confirmed.find((row) => row.leaderTelegramId === sender);
    if (!team) {
      await ctx.reply(texts.scrimDropsNotRegistered(parsed.claim.team), replyTo);
      return;
    }
    const store = dropsStoreFor(deps);
    try {
      await store.withLock(scrim.id, async () => {
        const state = await store.get(scrim.id);
        const decision = applyDropClaim(state, team.tag, { E: parsed.claim.E, M: parsed.claim.M });
        if (decision.kind === "taken") {
          await ctx.reply(texts.scrimDropsTaken(MAP_LABEL[decision.map], decision.n, decision.owner), replyTo);
          return;
        }
        if (decision.kind === "same") {
          await ctx.reply(texts.scrimDropsSame(formatTeamDrops(state.teams[team.tag])), replyTo);
          return;
        }
        await store.set(scrim.id, decision.state, dropsTtlSeconds(scrim));
        try {
          await ctx.react("👍");
        } catch {
          await ctx.reply(`👍 ${formatTeamDrops(decision.state.teams[team.tag])}`, replyTo);
        }
        if (decision.replaced) {
          await ctx.reply(texts.scrimDropsChanged(team.tag, formatTeamDrops(decision.state.teams[team.tag])), replyTo);
        }
      });
    } catch (error) {
      await ctx.reply(error instanceof AppError ? error.userMessage : "ما سجلنا النزلة، جرّب مرة ثانية.", replyTo);
    }
  });
}

export { spotName };
