import type { PrismaClient } from "@prisma/client";

export async function logUnmatchedUtterance(
  db: PrismaClient,
  input: { telegramId: string; storeId?: string | null; text: string; reason: string },
) {
  await db.unmatchedUtterance.create({
    data: {
      telegramId: input.telegramId,
      storeId: input.storeId || null,
      text: input.text.slice(0, 2000),
      reason: input.reason.slice(0, 120),
    },
  });
}

export async function listUnmatchedUtterances(db: PrismaClient, take = 80) {
  return db.unmatchedUtterance.findMany({
    take,
    orderBy: { createdAt: "desc" },
    include: { store: true },
  });
}
