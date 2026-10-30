import type { PrismaClient } from "@prisma/client";
import { AppError, ForbiddenError, NotFoundError } from "../domain/errors";
import { writeAudit } from "./audit";

export interface SellerView {
  id: string;
  telegramId: string;
  status: "ACTIVE" | "BANNED";
  homeStoreId: string | null;
}

function toSellerView(seller: {
  id: string;
  telegramId: string;
  status: "ACTIVE" | "BANNED";
  homeStoreId?: string | null;
}): SellerView {
  return {
    id: seller.id,
    telegramId: seller.telegramId,
    status: seller.status,
    homeStoreId: seller.homeStoreId ?? null,
  };
}

export async function getOrCreateSeller(db: PrismaClient, telegramId: string) {
  const seller = await db.seller.upsert({
    where: { telegramId },
    create: { telegramId },
    update: {},
  });
  return toSellerView(seller);
}

export async function assertSellerActive(db: PrismaClient, telegramId: string) {
  const seller = await getOrCreateSeller(db, telegramId);
  if (seller.status === "BANNED") {
    throw new AppError("seller banned", "حسابك محظور، تواصل مع المالك.", "BANNED");
  }
  return seller;
}

export async function bindSellerToStore(db: PrismaClient, telegramId: string, storeId: string) {
  const seller = await getOrCreateSeller(db, telegramId);
  const updated = await db.seller.update({
    where: { id: seller.id },
    data: { homeStoreId: storeId },
  });
  return toSellerView(updated);
}

export async function banSeller(
  db: PrismaClient,
  input: {
    actorTelegramId: string;
    ownerTelegramId: string;
    targetTelegramId: string;
    reason?: string;
  },
) {
  if (input.actorTelegramId !== input.ownerTelegramId) {
    throw new ForbiddenError();
  }
  if (input.targetTelegramId === input.ownerTelegramId) {
    throw new AppError("cannot ban owner", "ما يمديك تحظر حساب المالك.", "CANNOT_BAN_OWNER");
  }
  const seller = await db.seller.upsert({
    where: { telegramId: input.targetTelegramId },
    create: {
      telegramId: input.targetTelegramId,
      status: "BANNED",
      banReason: input.reason ?? null,
      bannedAt: new Date(),
    },
    update: {
      status: "BANNED",
      banReason: input.reason ?? null,
      bannedAt: new Date(),
    },
  });
  await writeAudit(db, {
    actorId: input.actorTelegramId,
    action: "seller.ban",
    entity: "Seller",
    entityId: seller.id,
    metadata: { telegramId: seller.telegramId, reason: input.reason ?? null },
  });
  return toSellerView(seller);
}

export async function unbanSeller(
  db: PrismaClient,
  input: { actorTelegramId: string; ownerTelegramId: string; targetTelegramId: string },
) {
  if (input.actorTelegramId !== input.ownerTelegramId) {
    throw new ForbiddenError();
  }
  const seller = await db.seller.findUnique({
    where: { telegramId: input.targetTelegramId },
  });
  if (!seller) {
    throw new NotFoundError("Seller", input.targetTelegramId, "ما لقيت هذا البائع.");
  }
  const updated = await db.seller.update({
    where: { id: seller.id },
    data: { status: "ACTIVE", banReason: null, bannedAt: null },
  });
  await writeAudit(db, {
    actorId: input.actorTelegramId,
    action: "seller.unban",
    entity: "Seller",
    entityId: updated.id,
    metadata: { telegramId: updated.telegramId },
  });
  return toSellerView(updated);
}
