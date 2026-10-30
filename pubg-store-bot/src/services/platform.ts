import { randomBytes } from "node:crypto";
import { Api } from "grammy";
import type { PrismaClient } from "@prisma/client";
import { DEFAULT_LISTING_TEMPLATE } from "../domain/caption";
import {
  formatMissingPermissions,
  isGroupChatType,
  missingChannelAdminPermissions,
} from "../domain/channel";
import { AppError, ConflictError, NotFoundError } from "../domain/errors";
import { trialExpiryHours } from "../domain/subscription";
import type { AppConfig } from "../config";
import {
  decryptSecret,
  encryptSecret,
  parseTokenEncryptionKey,
  redactTelegramError,
} from "../infra/token-cipher";
import { writeAudit } from "./audit";
import { toStoreView } from "./store";

export interface TelegramBotProfile {
  id: string;
  username: string;
  firstName: string;
}

export async function verifyBotToken(token: string): Promise<TelegramBotProfile> {
  const trimmed = token.trim();
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(trimmed)) {
    throw new AppError("invalid token", "توكن البوت غير صحيح.", "INVALID_BOT_TOKEN");
  }
  try {
    const api = new Api(trimmed);
    const me = await api.getMe();
    return {
      id: String(me.id),
      username: (me.username ?? "").replace(/^@/, ""),
      firstName: me.first_name ?? "",
    };
  } catch (error) {
    throw new AppError(
      redactTelegramError(error),
      "ما قدرت أتحقق من التوكن. تأكد إنه من BotFather وشغّال.",
      "INVALID_BOT_TOKEN",
    );
  }
}

export async function assertBotIsChannelAdmin(
  api: Api,
  channelId: string,
  opts: { actorTelegramId?: string } = {},
): Promise<{ chatType: string; title: string }> {
  const me = await api.getMe();
  let chatType: string | undefined;
  let title = "";
  try {
    const chat = await api.getChat(channelId);
    chatType = chat.type;
    title = "title" in chat && chat.title ? chat.title : "";
    if (chat.type !== "channel" && !isGroupChatType(chat.type)) {
      throw new AppError("not a channel", "هذي محادثة خاصة. أرسل قناة أو مجموعة.", "NOT_CHANNEL");
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    const migrated = migratedChatId(error);
    if (migrated) {
      throw new AppError(
        "group migrated",
        `المجموعة صارت «سوبر قروب» وتغيّر الآيدي حقها إلى ${migrated}. أرسل /setup مرة ثانية أو اكتب /bind داخل المجموعة.`,
        "GROUP_MIGRATED",
      );
    }
    throw new AppError(
      redactTelegramError(error),
      "ما قدرت أفتح هالقناة/المجموعة. تأكد إن البوت مضاف فيها وإن اليوزر أو الرابط صحيح.",
      "CHANNEL_NOT_FOUND",
    );
  }
  try {
    const member = await api.getChatMember(channelId, me.id);
    const flag = (key: string) =>
      key in member ? (member as unknown as Record<string, boolean | undefined>)[key] : undefined;
    const missing = missingChannelAdminPermissions({
      chatType,
      status: member.status,
      canPostMessages: flag("can_post_messages"),
      canDeleteMessages: flag("can_delete_messages"),
      canSendMessages: flag("can_send_messages"),
    });
    if (missing.length > 0) {
      throw new AppError("bot not admin", formatMissingPermissions(missing, chatType), "BOT_NOT_ADMIN");
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      redactTelegramError(error),
      formatMissingPermissions(
        chatType === "channel" ? ["عضوية القناة", "أدمن", "نشر الرسائل"] : ["عضوية المجموعة", "أدمن"],
        chatType,
      ),
      "BOT_NOT_ADMIN",
    );
  }
  if (opts.actorTelegramId && chatType && isGroupChatType(chatType)) {
    let status = "";
    try {
      status = (await api.getChatMember(channelId, Number(opts.actorTelegramId))).status;
    } catch {
      status = "";
    }
    if (status !== "creator" && status !== "administrator") {
      throw new AppError(
        "actor not group admin",
        "لازم تكون أنت مشرف أو مالك المجموعة عشان تربطها بالمتجر.\nاطلب من مالك المجموعة يرفعك مشرف، أو خله هو يرسل /bind داخل المجموعة.",
        "ACTOR_NOT_ADMIN",
      );
    }
  }
  return { chatType: chatType ?? "", title };
}

/** Telegram returns migrate_to_chat_id when a basic group became a supergroup. */
export function migratedChatId(error: unknown): string | null {
  const e = error as { parameters?: { migrate_to_chat_id?: number }; error?: { parameters?: { migrate_to_chat_id?: number } } };
  const id = e?.parameters?.migrate_to_chat_id ?? e?.error?.parameters?.migrate_to_chat_id;
  return id ? String(id) : null;
}

/** Moves a store binding from an old basic-group id to its new supergroup id. */
export async function migrateStoreChat(db: PrismaClient, fromChatId: string, toChatId: string) {
  const store = await db.store.findUnique({ where: { channelId: fromChatId } });
  if (!store) return null;
  const clash = await db.store.findUnique({ where: { channelId: toChatId } });
  if (clash) return null;
  const updated = await db.store.update({ where: { id: store.id }, data: { channelId: toChatId } });
  await writeAudit(db, {
    actorId: "telegram",
    action: "store.channel.migrate",
    entity: "Store",
    entityId: store.id,
    metadata: { from: fromChatId, to: toChatId },
  });
  return toStoreView(updated);
}

function newWebhookSecret() {
  return randomBytes(24).toString("hex");
}

export async function bootstrapLegacyStore(
  db: PrismaClient,
  config: AppConfig,
  profile: TelegramBotProfile,
) {
  const first = await db.store.findFirst({ orderBy: { createdAt: "asc" } });
  const cipher = encryptSecret(config.BOT_TOKEN, config.tokenEncryptionKey);
  if (!first) {
    const created = await db.store.create({
      data: {
        channelId: config.DEFAULT_CHANNEL_ID,
        title: config.ownerUsername,
        ownerUsername: config.ownerUsername,
        ownerTelegramId: config.OWNER_TELEGRAM_ID,
        botTelegramId: profile.id,
        botUsername: profile.username,
        botFirstName: profile.firstName,
        tokenCipher: cipher,
        webhookSecret: newWebhookSecret(),
        botEnabled: true,
        listingTemplate: DEFAULT_LISTING_TEMPLATE,
        listingFee: config.LISTING_FEE,
        coverEnabled: false,
        publishMode: config.PUBLISH_MODE,
        plan: "MONTHLY",
        subscriptionStatus: "TRIAL",
        subscriptionExpiresAt: trialExpiryHours(new Date(), config.TRIAL_HOURS),
      },
    });
    await claimTrial(db, created.id, "owner", config.OWNER_TELEGRAM_ID);
    await claimTrial(db, created.id, "channel", config.DEFAULT_CHANNEL_ID);
    return toStoreView(created);
  }

  if (!first.tokenCipher || !first.botTelegramId) {
    const updated = await db.store.update({
      where: { id: first.id },
      data: {
        botTelegramId: first.botTelegramId || profile.id,
        botUsername: first.botUsername || profile.username,
        botFirstName: first.botFirstName || profile.firstName,
        tokenCipher: first.tokenCipher || cipher,
        webhookSecret: first.webhookSecret || newWebhookSecret(),
      },
    });
    return toStoreView(updated);
  }
  return toStoreView(first);
}

export async function addStoreFromToken(
  db: PrismaClient,
  config: AppConfig,
  input: { token: string; actorTelegramId: string },
) {
  const profile = await verifyBotToken(input.token);
  const cipher = encryptSecret(input.token, config.tokenEncryptionKey);
  const existing = await db.store.findUnique({ where: { botTelegramId: profile.id } });
  if (existing) {
    const updated = await db.store.update({
      where: { id: existing.id },
      data: {
        tokenCipher: cipher,
        botUsername: profile.username,
        botFirstName: profile.firstName,
        botEnabled: true,
        webhookSecret: existing.webhookSecret || newWebhookSecret(),
      },
    });
    await writeAudit(db, {
      actorId: input.actorTelegramId,
      action: "store.bot.token",
      entity: "Store",
      entityId: updated.id,
      metadata: { botTelegramId: profile.id, botUsername: profile.username },
    });
    return { store: toStoreView(updated), created: false, profile };
  }

  const created = await db.store.create({
    data: {
      channelId: null,
      title: profile.firstName || profile.username || "متجر جديد",
      ownerUsername: "",
      ownerTelegramId: "",
      botTelegramId: profile.id,
      botUsername: profile.username,
      botFirstName: profile.firstName,
      tokenCipher: cipher,
      webhookSecret: newWebhookSecret(),
      botEnabled: true,
      listingTemplate: DEFAULT_LISTING_TEMPLATE,
      listingFee: 0,
      coverEnabled: false,
      publishMode: "AUTO",
      plan: "MONTHLY",
      subscriptionStatus: "TRIAL",
      subscriptionExpiresAt: trialExpiryHours(new Date(), config.TRIAL_HOURS),
    },
  });
  await writeAudit(db, {
    actorId: input.actorTelegramId,
    action: "store.bot.add",
    entity: "Store",
    entityId: created.id,
    metadata: { botTelegramId: profile.id, botUsername: profile.username },
  });
  return { store: toStoreView(created), created: true, profile };
}

export async function bindStoreChannel(
  db: PrismaClient,
  api: Api,
  input: {
    storeId: string;
    channelId: string;
    actorTelegramId: string;
    actorUsername?: string;
    trialHours: number;
    now?: Date;
    /** Super admin binding on someone's behalf: skip the "you must be a group admin" check. */
    skipActorCheck?: boolean;
  },
) {
  const store = await db.store.findUnique({ where: { id: input.storeId } });
  if (!store) throw new NotFoundError("Store", input.storeId, "ما لقيت هذا المتجر.");
  const target = await assertBotIsChannelAdmin(api, input.channelId, {
    actorTelegramId: input.skipActorCheck ? undefined : input.actorTelegramId,
  });

  const taken = await db.store.findUnique({ where: { channelId: input.channelId } });
  if (taken && taken.id !== store.id) {
    throw new ConflictError("channel taken", "هالقناة/المجموعة مربوطة بمتجر ثاني.");
  }

  const now = input.now ?? new Date();
  const ownerId = store.ownerTelegramId || input.actorTelegramId;
  const ownerUsername = store.ownerUsername || (input.actorUsername ?? "").replace(/^@/, "");

  const ownerClaim = await db.trialClaim.findUnique({
    where: { kind_value: { kind: "owner", value: ownerId } },
  });
  const channelClaim = await db.trialClaim.findUnique({
    where: { kind_value: { kind: "channel", value: input.channelId } },
  });
  if (channelClaim && channelClaim.storeId !== store.id) {
    throw new ConflictError("trial channel", "هالقناة/المجموعة استخدمت تجربة من قبل، ما ينعاد التجريب عليها.");
  }

  const reuseOwnerTrial = Boolean(ownerClaim && ownerClaim.storeId !== store.id);
  const updated = await db.store.update({
    where: { id: store.id },
    data: {
      channelId: input.channelId,
      ownerTelegramId: ownerId,
      ownerUsername: ownerUsername || store.botUsername,
      title: store.title || ownerUsername || store.botFirstName,
      ...(reuseOwnerTrial
        ? { subscriptionStatus: "EXPIRED" as const, subscriptionExpiresAt: now }
        : {}),
    },
  });

  if (!reuseOwnerTrial) {
    await claimTrial(db, store.id, "owner", ownerId);
  }
  await claimTrial(db, store.id, "channel", input.channelId);

  await writeAudit(db, {
    actorId: input.actorTelegramId,
    action: "store.channel.bind",
    entity: "Store",
    entityId: store.id,
    metadata: { channelId: input.channelId, reusedTrial: reuseOwnerTrial },
  });
  return { store: toStoreView(updated), reusedTrial: reuseOwnerTrial, chatType: target.chatType, chatTitle: target.title };
}

export async function detachStoreBot(
  db: PrismaClient,
  input: { storeId: string; actorTelegramId: string },
) {
  const store = await db.store.findUnique({ where: { id: input.storeId } });
  if (!store) throw new NotFoundError("Store", input.storeId, "ما لقيت هذا المتجر.");
  const updated = await db.store.update({
    where: { id: store.id },
    data: {
      tokenCipher: null,
      botEnabled: false,
      subscriptionStatus: "CANCELED",
    },
  });
  await writeAudit(db, {
    actorId: input.actorTelegramId,
    action: "store.bot.delete",
    entity: "Store",
    entityId: store.id,
    metadata: { botTelegramId: store.botTelegramId, botUsername: store.botUsername },
  });
  return toStoreView(updated);
}

async function claimTrial(db: PrismaClient, storeId: string, kind: string, value: string) {
  await db.trialClaim.upsert({
    where: { kind_value: { kind, value } },
    create: { kind, value, storeId },
    update: { storeId },
  });
}

/** If TOKEN_ENCRYPTION_KEY was added after first encrypt, rewrap from the BOT_TOKEN-derived key. */
export async function rewrapStoreTokens(db: PrismaClient, config: AppConfig) {
  const previousKey = parseTokenEncryptionKey("", config.BOT_TOKEN);
  if (previousKey.equals(config.tokenEncryptionKey)) return { migrated: 0, already: 0, failed: 0 };
  const stores = await db.store.findMany({ where: { tokenCipher: { not: null } } });
  let migrated = 0;
  let already = 0;
  let failed = 0;
  for (const store of stores) {
    const cipher = store.tokenCipher;
    if (!cipher) continue;
    try {
      decryptSecret(cipher, config.tokenEncryptionKey);
      already += 1;
      continue;
    } catch {
      // still on the previous derived key
    }
    try {
      const plain = decryptSecret(cipher, previousKey);
      await db.store.update({
        where: { id: store.id },
        data: { tokenCipher: encryptSecret(plain, config.tokenEncryptionKey) },
      });
      migrated += 1;
    } catch {
      failed += 1;
    }
  }
  return { migrated, already, failed };
}

export async function decryptStoreToken(
  db: PrismaClient,
  config: AppConfig,
  storeId: string,
): Promise<string | null> {
  const store = await db.store.findUnique({ where: { id: storeId } });
  if (!store?.tokenCipher) return null;
  return decryptSecret(store.tokenCipher, config.tokenEncryptionKey);
}

/** Attaches a second Telegram bot to a store that only runs scrims. The token is stored encrypted. */
export async function attachScrimBot(
  db: PrismaClient,
  config: AppConfig,
  input: { storeId: string; token: string; actorTelegramId: string },
) {
  const profile = await verifyBotToken(input.token);
  const store = await db.store.findUnique({ where: { id: input.storeId } });
  if (!store) throw new AppError("store not found", "ما لقيت المتجر.", "NOT_FOUND");
  const clash = await db.store.findFirst({
    where: {
      OR: [{ botTelegramId: profile.id }, { scrimBotTelegramId: profile.id, NOT: { id: input.storeId } }],
    },
  });
  if (clash) throw new AppError("bot in use", "هالبوت مربوط بمتجر ثاني. استخدم بوت جديد للسكرمات.", "SCRIM_BOT_IN_USE");
  const updated = await db.store.update({
    where: { id: input.storeId },
    data: {
      scrimBotTokenCipher: encryptSecret(input.token, config.tokenEncryptionKey),
      scrimBotTelegramId: profile.id,
      scrimBotUsername: profile.username,
    },
  });
  await writeAudit(db, {
    actorId: input.actorTelegramId,
    action: "store.scrimbot.attach",
    entity: "Store",
    entityId: updated.id,
    metadata: { scrimBotTelegramId: profile.id, scrimBotUsername: profile.username },
  });
  return { store: updated, profile };
}

export async function detachScrimBot(db: PrismaClient, input: { storeId: string; actorTelegramId: string }) {
  const updated = await db.store.update({
    where: { id: input.storeId },
    data: { scrimBotTokenCipher: null, scrimBotTelegramId: null, scrimBotUsername: null },
  });
  await writeAudit(db, {
    actorId: input.actorTelegramId,
    action: "store.scrimbot.detach",
    entity: "Store",
    entityId: updated.id,
    metadata: {},
  });
  return updated;
}

export async function decryptScrimBotToken(db: PrismaClient, config: AppConfig, storeId: string): Promise<string | null> {
  const store = await db.store.findUnique({ where: { id: storeId } });
  if (!store?.scrimBotTokenCipher) return null;
  return decryptSecret(store.scrimBotTokenCipher, config.tokenEncryptionKey);
}

/** Clears a store's channel binding (super admin). Listings/trial claims stay as they are. */
export async function unbindStoreChannel(
  db: PrismaClient,
  input: { storeId: string; actorTelegramId: string },
) {
  const store = await db.store.findUnique({ where: { id: input.storeId } });
  if (!store) throw new NotFoundError("Store", input.storeId, "ما لقيت هذا المتجر.");
  if (!store.channelId) {
    throw new AppError("no channel", "هالمتجر ما عنده قناة أو مجموعة مربوطة أصلًا.", "NO_CHANNEL");
  }
  const updated = await db.store.update({ where: { id: store.id }, data: { channelId: null } });
  await writeAudit(db, {
    actorId: input.actorTelegramId,
    action: "store.channel.unbind",
    entity: "Store",
    entityId: store.id,
    metadata: { channelId: store.channelId },
  });
  return toStoreView(updated);
}
