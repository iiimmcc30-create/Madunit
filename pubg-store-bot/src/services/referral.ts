import type { PrismaClient, ReferralRole } from "@prisma/client";

export interface TrackReferralInput {
  storeId: string;
  telegramId: string;
  role: ReferralRole;
  source: string;
}

export async function trackReferral(db: PrismaClient, input: TrackReferralInput) {
  await db.storeReferral.upsert({
    where: {
      storeId_telegramId_role: {
        storeId: input.storeId,
        telegramId: input.telegramId,
        role: input.role,
      },
    },
    create: {
      storeId: input.storeId,
      telegramId: input.telegramId,
      role: input.role,
      source: input.source,
    },
    update: {},
  });
}

export async function countReferrals(
  db: PrismaClient,
  storeId: string,
): Promise<{ sellers: number; buyers: number }> {
  const [sellers, buyers] = await Promise.all([
    db.storeReferral.count({ where: { storeId, role: "SELLER" } }),
    db.storeReferral.count({ where: { storeId, role: "BUYER" } }),
  ]);
  return { sellers, buyers };
}
