import type { Prisma, PrismaClient } from "@prisma/client";

export interface AuditInput {
  actorId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

export async function writeAudit(db: PrismaClient | Prisma.TransactionClient, input: AuditInput) {
  await db.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      metadata: input.metadata ?? {},
    },
  });
}

export async function listRecentAudit(db: PrismaClient, take = 15) {
  return db.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take,
  });
}

export function formatAuditLine(row: {
  createdAt: Date;
  action: string;
  entity: string;
  entityId?: string | null;
  actorId?: string | null;
}): string {
  const when = row.createdAt.toISOString().replace("T", " ").slice(0, 16);
  const target = row.entityId ? ` ${row.entityId}` : "";
  const actor = row.actorId ? ` بواسطة ${row.actorId}` : "";
  return `${when} — ${row.action} (${row.entity}${target})${actor}`;
}
