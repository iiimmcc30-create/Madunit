import { Prisma, type PrismaClient, type PublishMode, type Store, type StorePlan, type SubscriptionStatus } from "@prisma/client";
import { DEFAULT_LISTING_TEMPLATE } from "../domain/caption";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "../domain/errors";
import { parseGlossary, type GlossaryEntry } from "../domain/glossary";
import { formatSubscription, storeRuntimeStatus, trialExpiry, trialExpiryHours } from "../domain/subscription";
import type { AppConfig } from "../config";
import { writeAudit } from "./audit";

export interface StoreView {
  id: string;
  channelId: string | null;
  tradersGroupId: string | null;
  title: string;
  ownerUsername: string;
  ownerTelegramId: string;
  botTelegramId: string | null;
  botUsername: string;
  botFirstName: string;
  botEnabled: boolean;
  listingTemplate: string;
  listingFee: number;
  paymentInstructions: string;
  coverEnabled: boolean;
  customGlossary: GlossaryEntry[];
  publishMode: PublishMode;
  plan: StorePlan;
  subscriptionStatus: SubscriptionStatus;
  subscriptionExpiresAt: Date | null;
  subscriptionLabel: string;
  runtimeStatus: string;
}

export function toStoreView(store: Store): StoreView {
  return {
    id: store.id,
    channelId: store.channelId,
    tradersGroupId: store.tradersGroupId ?? null,
    title: store.title || store.botUsername || store.ownerUsername,
    ownerUsername: store.ownerUsername,
    ownerTelegramId: store.ownerTelegramId,
    botTelegramId: store.botTelegramId ?? null,
    botUsername: store.botUsername ?? "",
    botFirstName: store.botFirstName ?? "",
    botEnabled: store.botEnabled !== false,
    listingTemplate: store.listingTemplate ?? "",
    listingFee: store.listingFee.toNumber(),
    paymentInstructions: store.paymentInstructions ?? "",
    coverEnabled: store.coverEnabled === true,
    customGlossary: parseGlossary(store.customGlossary),
    publishMode: store.publishMode ?? "AUTO",
    plan: store.plan ?? "MONTHLY",
    subscriptionStatus: store.subscriptionStatus ?? "TRIAL",
    subscriptionExpiresAt: store.subscriptionExpiresAt,
    subscriptionLabel: formatSubscription({
      subscriptionStatus: store.subscriptionStatus ?? "TRIAL",
      subscriptionExpiresAt: store.subscriptionExpiresAt,
      plan: store.plan ?? "MONTHLY",
      botEnabled: store.botEnabled !== false,
    }),
    runtimeStatus: storeRuntimeStatus({
      botEnabled: store.botEnabled,
      subscriptionStatus: store.subscriptionStatus,
      subscriptionExpiresAt: store.subscriptionExpiresAt,
    }),
  };
}

export async function ensureDefaultStore(db: PrismaClient, config: AppConfig) {
  const existing = await db.store.findUnique({
    where: { channelId: config.DEFAULT_CHANNEL_ID },
  });
  if (existing) return toStoreView(existing);

  const created = await db.store.create({
    data: {
      channelId: config.DEFAULT_CHANNEL_ID,
      title: config.ownerUsername,
      ownerUsername: config.ownerUsername,
      ownerTelegramId: config.OWNER_TELEGRAM_ID,
      listingTemplate: DEFAULT_LISTING_TEMPLATE,
      listingFee: config.LISTING_FEE,
      coverEnabled: false,
      publishMode: config.PUBLISH_MODE as PublishMode,
      plan: "MONTHLY",
      subscriptionStatus: "TRIAL",
      subscriptionExpiresAt: trialExpiryHours(new Date(), config.TRIAL_HOURS),
    },
  });
  return toStoreView(created);
}

export async function listStores(db: PrismaClient): Promise<StoreView[]> {
  const rows = await db.store.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map(toStoreView);
}

export async function listAdminStores(db: PrismaClient) {
  const rows = await db.store.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { listings: true } } },
  });
  return rows.map((row) => ({
    ...toStoreView(row),
    listingCount: row._count.listings,
  }));
}

export async function listStoresForOwner(db: PrismaClient, telegramId: string): Promise<StoreView[]> {
  const rows = await db.store.findMany({
    where: { ownerTelegramId: telegramId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toStoreView);
}

export async function getStoreById(db: PrismaClient, id: string): Promise<StoreView> {
  const store = await db.store.findUnique({ where: { id } });
  if (!store) {
    throw new NotFoundError("Store", id, "ما لقيت هذا المتجر.");
  }
  return toStoreView(store);
}

export async function getDefaultStore(db: PrismaClient, channelId: string): Promise<StoreView> {
  const store = await db.store.findUnique({ where: { channelId } });
  if (!store) {
    throw new Error(`store not seeded for channel ${channelId}`);
  }
  return toStoreView(store);
}

export async function getRawStore(db: PrismaClient, id: string) {
  const store = await db.store.findUnique({ where: { id } });
  if (!store) throw new NotFoundError("Store", id, "ما لقيت هذا المتجر.");
  return store;
}

export async function isPrivilegedOwner(
  db: PrismaClient,
  config: AppConfig,
  telegramId: string,
): Promise<boolean> {
  if (telegramId === config.superAdminTelegramId || telegramId === config.OWNER_TELEGRAM_ID) {
    return true;
  }
  const count = await db.store.count({ where: { ownerTelegramId: telegramId } });
  return count > 0;
}

export function isStoreOperator(
  store: Pick<StoreView, "ownerTelegramId">,
  telegramId: string,
  superAdminId: string,
): boolean {
  if (telegramId === superAdminId) return true;
  return Boolean(store.ownerTelegramId) && store.ownerTelegramId === telegramId;
}

export async function assertStoreOwner(store: StoreView, actorTelegramId: string, envOwnerId: string) {
  if (actorTelegramId === envOwnerId || store.ownerTelegramId === actorTelegramId) return;
  throw new ForbiddenError();
}

export async function createStore(
  db: PrismaClient,
  input: {
    actorTelegramId: string;
    envOwnerId: string;
    channelId: string;
    title: string;
    ownerUsername: string;
    listingFee: number;
    publishMode: PublishMode;
  },
): Promise<StoreView> {
  if (input.actorTelegramId !== input.envOwnerId) {
    const alreadyOwner = await db.store.count({
      where: { ownerTelegramId: input.actorTelegramId },
    });
    if (!alreadyOwner) throw new ForbiddenError();
  }
  const existing = await db.store.findUnique({ where: { channelId: input.channelId } });
  if (existing) {
    throw new ConflictError("store exists", "هالقناة مسجّلة من قبل.");
  }
  const created = await db.store.create({
    data: {
      channelId: input.channelId,
      title: input.title.trim() || input.ownerUsername,
      ownerUsername: input.ownerUsername.replace(/^@/, ""),
      ownerTelegramId: input.actorTelegramId,
      listingTemplate: DEFAULT_LISTING_TEMPLATE,
      listingFee: input.listingFee,
      coverEnabled: false,
      publishMode: input.publishMode,
      plan: "MONTHLY",
      subscriptionStatus: "TRIAL",
      subscriptionExpiresAt: trialExpiry(),
    },
  });
  await writeAudit(db, {
    actorId: input.actorTelegramId,
    action: "store.create",
    entity: "Store",
    entityId: created.id,
    metadata: { channelId: created.channelId },
  });
  return toStoreView(created);
}

export async function updateStoreSettings(
  db: PrismaClient,
  input: {
    storeId: string;
    actorTelegramId: string;
    envOwnerId: string;
    title?: string;
    ownerUsername?: string;
    listingFee?: number;
    paymentInstructions?: string;
    publishMode?: PublishMode;
    customGlossary?: GlossaryEntry[];
  },
): Promise<StoreView> {
  const store = await db.store.findUnique({ where: { id: input.storeId } });
  if (!store) {
    throw new NotFoundError("Store", input.storeId, "ما لقيت هذا المتجر.");
  }
  await assertStoreOwner(toStoreView(store), input.actorTelegramId, input.envOwnerId);
  const updated = await db.store.update({
    where: { id: store.id },
    data: {
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.ownerUsername !== undefined
        ? { ownerUsername: input.ownerUsername.replace(/^@/, "").trim() }
        : {}),
      ...(input.listingFee !== undefined ? { listingFee: input.listingFee } : {}),
      ...(input.paymentInstructions !== undefined
        ? { paymentInstructions: input.paymentInstructions.trim() }
        : {}),
      ...(input.publishMode !== undefined ? { publishMode: input.publishMode } : {}),
      ...(input.customGlossary !== undefined
        ? { customGlossary: input.customGlossary as unknown as Prisma.InputJsonValue }
        : {}),
    },
  });
  await writeAudit(db, {
    actorId: input.actorTelegramId,
    action: "store.settings",
    entity: "Store",
    entityId: updated.id,
    metadata: {
      title: input.title ?? null,
      listingFee: input.listingFee ?? null,
      publishMode: input.publishMode ?? null,
    },
  });
  return toStoreView(updated);
}

export function storeLabel(store: StoreView): string {
  return store.title || `@${store.ownerUsername}`;
}

export function createStoreService(db: PrismaClient, config: AppConfig) {
  return {
    ensureDefault: () => ensureDefaultStore(db, config),
    list: () => listStores(db),
    listForOwner: (telegramId: string) => listStoresForOwner(db, telegramId),
    getById: (id: string) => getStoreById(db, id),
    isPrivilegedOwner: (telegramId: string) => isPrivilegedOwner(db, config, telegramId),
  };
}

export type StoreService = ReturnType<typeof createStoreService>;
