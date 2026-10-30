import { Prisma, type PrismaClient, type Store } from "@prisma/client";
import { AppError, ForbiddenError, NotFoundError } from "../domain/errors";
import {
  extendSubscriptionExpiry,
  isExpiredAt,
  isSubscriptionOpen,
  shouldRemindSubscription,
  storeRuntimeStatus,
  type SubscriptionStatus,
} from "../domain/subscription";
import { writeAudit } from "./audit";

export function assertStoreServiceOpen(store: {
  botEnabled?: boolean;
  subscriptionStatus: SubscriptionStatus;
  subscriptionExpiresAt?: Date | null;
}, now = new Date()) {
  if (!isSubscriptionOpen({ ...store, now })) {
    throw new AppError("store service stopped", "الخدمة متوقفة مؤقتًا.", "STORE_STOPPED");
  }
}

export async function expireDueStores(db: PrismaClient, now = new Date()) {
  const open = await db.store.findMany({
    where: { subscriptionStatus: { in: ["TRIAL", "ACTIVE"] } },
  });
  const due = open.filter((row) => isExpiredAt(row.subscriptionExpiresAt, now));
  const ids = due.map((row) => row.id);
  if (ids.length === 0) return [];
  await db.store.updateMany({
    where: { id: { in: ids } },
    data: { subscriptionStatus: "EXPIRED" },
  });
  return due;
}

export async function extendStoreSubscription(
  db: PrismaClient,
  input: {
    storeId: string;
    actorTelegramId: string;
    days: number;
    now?: Date;
  },
) {
  const store = await db.store.findUnique({ where: { id: input.storeId } });
  if (!store) throw new NotFoundError("Store", input.storeId, "ما لقيت هذا المتجر.");
  const now = input.now ?? new Date();
  const expires = extendSubscriptionExpiry(store.subscriptionExpiresAt, now, input.days);
  const updated = await db.store.update({
    where: { id: store.id },
    data: {
      subscriptionStatus: "ACTIVE",
      plan: "MONTHLY",
      subscriptionExpiresAt: expires,
      subscriptionRemindedAt: null,
    },
  });
  await writeAudit(db, {
    actorId: input.actorTelegramId,
    action: "store.subscription.extend",
    entity: "Store",
    entityId: store.id,
    metadata: { days: input.days, until: expires.toISOString() },
  });
  return updated;
}

export async function setStoreEnabled(
  db: PrismaClient,
  input: { storeId: string; actorTelegramId: string; enabled: boolean },
) {
  const store = await db.store.findUnique({ where: { id: input.storeId } });
  if (!store) throw new NotFoundError("Store", input.storeId, "ما لقيت هذا المتجر.");
  const updated = await db.store.update({
    where: { id: store.id },
    data: { botEnabled: input.enabled },
  });
  await writeAudit(db, {
    actorId: input.actorTelegramId,
    action: input.enabled ? "store.bot.enable" : "store.bot.disable",
    entity: "Store",
    entityId: store.id,
    metadata: {},
  });
  return updated;
}

export async function listStoresNeedingReminder(
  db: PrismaClient,
  input: { now?: Date; reminderHours: number },
) {
  const open = await db.store.findMany({
    where: {
      botEnabled: true,
      subscriptionStatus: { in: ["TRIAL", "ACTIVE"] },
      subscriptionRemindedAt: null,
    },
  });
  const now = input.now ?? new Date();
  return open.filter((row) =>
    shouldRemindSubscription({
      subscriptionStatus: row.subscriptionStatus,
      subscriptionExpiresAt: row.subscriptionExpiresAt,
      subscriptionRemindedAt: row.subscriptionRemindedAt,
      botEnabled: row.botEnabled,
      now,
      reminderHours: input.reminderHours,
    }),
  );
}

export async function markSubscriptionReminded(db: PrismaClient, storeId: string, now = new Date()) {
  await db.store.update({
    where: { id: storeId },
    data: { subscriptionRemindedAt: now },
  });
}

export async function submitSubscriptionReceipt(
  db: PrismaClient,
  input: {
    storeId: string;
    payerTelegramId: string;
    photoFileId: string;
    amount: number;
    periodDays: number;
  },
) {
  const store = await db.store.findUnique({ where: { id: input.storeId } });
  if (!store) throw new NotFoundError("Store", input.storeId, "ما لقيت هذا المتجر.");
  if (
    input.payerTelegramId !== store.ownerTelegramId &&
    store.ownerTelegramId &&
    store.ownerTelegramId.length > 0
  ) {
    throw new ForbiddenError();
  }
  return db.subscriptionPayment.create({
    data: {
      storeId: store.id,
      amount: new Prisma.Decimal(input.amount),
      receiptPhotoFileId: input.photoFileId,
      status: "PENDING",
      payerTelegramId: input.payerTelegramId,
      periodDays: input.periodDays,
    },
  });
}

export async function confirmSubscriptionPayment(
  db: PrismaClient,
  input: { paymentId: string; actorTelegramId: string; now?: Date },
) {
  const payment = await db.subscriptionPayment.findUnique({
    where: { id: input.paymentId },
    include: { store: true },
  });
  if (!payment) throw new NotFoundError("SubscriptionPayment", input.paymentId, "ما لقيت الإيصال.");
  if (payment.status !== "PENDING") {
    throw new AppError("payment closed", "هذا الإيصال تعالج من قبل.", "PAYMENT_CLOSED");
  }
  const updatedStore = await extendStoreSubscription(db, {
    storeId: payment.storeId,
    actorTelegramId: input.actorTelegramId,
    days: payment.periodDays,
    now: input.now,
  });
  const updatedPayment = await db.subscriptionPayment.update({
    where: { id: payment.id },
    data: { status: "CONFIRMED" },
  });
  return { payment: updatedPayment, store: updatedStore };
}

export async function rejectSubscriptionPayment(
  db: PrismaClient,
  input: { paymentId: string; actorTelegramId: string },
) {
  const payment = await db.subscriptionPayment.findUnique({ where: { id: input.paymentId } });
  if (!payment) throw new NotFoundError("SubscriptionPayment", input.paymentId, "ما لقيت الإيصال.");
  if (payment.status !== "PENDING") {
    throw new AppError("payment closed", "هذا الإيصال تعالج من قبل.", "PAYMENT_CLOSED");
  }
  const updated = await db.subscriptionPayment.update({
    where: { id: payment.id },
    data: { status: "REJECTED" },
  });
  await writeAudit(db, {
    actorId: input.actorTelegramId,
    action: "store.subscription.reject",
    entity: "SubscriptionPayment",
    entityId: payment.id,
    metadata: { storeId: payment.storeId },
  });
  return updated;
}

export async function listPendingSubscriptionPayments(db: PrismaClient) {
  return db.subscriptionPayment.findMany({
    where: { status: "PENDING" },
    include: { store: true },
    orderBy: { createdAt: "desc" },
    take: 80,
  });
}

export function expectedMonthlyRevenue(stores: Array<{ botEnabled: boolean; subscriptionStatus: string }>, price: number) {
  const active = stores.filter(
    (row) => row.botEnabled && (row.subscriptionStatus === "ACTIVE" || row.subscriptionStatus === "TRIAL"),
  ).length;
  return { activeStores: active, expectedMonthly: active * price };
}

export { storeRuntimeStatus };
export type { Store };
