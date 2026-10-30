import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  confirmSubscriptionPayment,
  expectedMonthlyRevenue,
  expireDueStores,
  extendStoreSubscription,
  listStoresNeedingReminder,
  setStoreEnabled,
} from "../src/services/subscription";

function storeRow(id: string, patch: Record<string, unknown> = {}) {
  return {
    id,
    channelId: `-100${id}`,
    title: id,
    ownerUsername: "owner",
    ownerTelegramId: "owner-1",
    botTelegramId: null,
    botUsername: "bot",
    botFirstName: "Bot",
    tokenCipher: "cipher",
    webhookSecret: "secret",
    botEnabled: true,
    listingTemplate: "",
    listingFee: new Prisma.Decimal(0),
    paymentInstructions: "",
    coverTheme: {},
    coverEnabled: false,
    customGlossary: [],
    publishMode: "AUTO",
    listingSeq: 0,
    plan: "MONTHLY",
    subscriptionStatus: "TRIAL",
    subscriptionExpiresAt: new Date("2026-10-14T00:00:00.000Z"),
    subscriptionRemindedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...patch,
  };
}

function createDb(rows: ReturnType<typeof storeRow>[]) {
  const stores = new Map(rows.map((row) => [row.id, row]));
  const payments = new Map<string, Record<string, unknown>>();
  const db = {
    store: {
      findMany: async ({
        where,
      }: {
        where?: { subscriptionStatus?: { in: string[] }; botEnabled?: boolean; subscriptionRemindedAt?: null };
      }) =>
        [...stores.values()].filter((row) => {
          if (where?.subscriptionStatus?.in && !where.subscriptionStatus.in.includes(row.subscriptionStatus as string)) {
            return false;
          }
          if (where?.botEnabled !== undefined && row.botEnabled !== where.botEnabled) return false;
          if (where?.subscriptionRemindedAt === null && row.subscriptionRemindedAt) return false;
          return true;
        }),
      findUnique: async ({ where }: { where: { id: string } }) => stores.get(where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = stores.get(where.id);
        if (!row) return null;
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({ where, data }: { where: { id: { in: string[] } }; data: Record<string, unknown> }) => {
        for (const id of where.id.in) {
          const row = stores.get(id);
          if (row) Object.assign(row, data);
        }
        return { count: where.id.in.length };
      },
    },
    subscriptionPayment: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = payments.get(where.id);
        if (!row) return null;
        return { ...row, store: stores.get(row.storeId as string) };
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = payments.get(where.id);
        if (row) Object.assign(row, data);
        return row;
      },
    },
    auditLog: { create: async () => ({}) },
  };
  return { db, stores, payments };
}

describe("subscription service", () => {
  const now = new Date("2026-10-13T12:00:00.000Z");

  it("expires due trials and keeps a later trial open", async () => {
    const { db, stores } = createDb([
      storeRow("due", { subscriptionExpiresAt: new Date("2026-10-13T11:00:00.000Z") }),
      storeRow("open", { subscriptionExpiresAt: new Date("2026-10-14T12:00:00.000Z") }),
    ]);
    const expired = await expireDueStores(db as never, now);
    expect(expired.map((row) => row.id)).toEqual(["due"]);
    expect(stores.get("due")?.subscriptionStatus).toBe("EXPIRED");
    expect(stores.get("open")?.subscriptionStatus).toBe("TRIAL");
  });

  it("extends 30 days from the later of expiry or today", async () => {
    const { db, stores } = createDb([
      storeRow("future", { subscriptionExpiresAt: new Date("2026-11-01T00:00:00.000Z") }),
      storeRow("past", { subscriptionExpiresAt: new Date("2026-01-01T00:00:00.000Z") }),
    ]);
    await extendStoreSubscription(db as never, { storeId: "future", actorTelegramId: "admin", days: 30, now });
    await extendStoreSubscription(db as never, { storeId: "past", actorTelegramId: "admin", days: 30, now });
    expect(stores.get("future")?.subscriptionExpiresAt?.toISOString().slice(0, 10)).toBe("2026-12-01");
    expect(stores.get("past")?.subscriptionExpiresAt?.toISOString().slice(0, 10)).toBe("2026-11-12");
    expect(stores.get("past")?.subscriptionStatus).toBe("ACTIVE");
  });

  it("confirms a pending receipt by extending the store", async () => {
    const { db, stores, payments } = createDb([
      storeRow("s1", { subscriptionExpiresAt: new Date("2026-10-10T00:00:00.000Z") }),
    ]);
    payments.set("pay-1", {
      id: "pay-1",
      storeId: "s1",
      status: "PENDING",
      periodDays: 30,
      payerTelegramId: "owner-1",
    });
    const result = await confirmSubscriptionPayment(db as never, {
      paymentId: "pay-1",
      actorTelegramId: "admin",
      now,
    });
    expect(result.payment.status).toBe("CONFIRMED");
    expect(stores.get("s1")?.subscriptionStatus).toBe("ACTIVE");
    expect(result.store.subscriptionExpiresAt?.toISOString().slice(0, 10)).toBe("2026-11-12");
  });

  it("lists reminder targets inside the 12-hour window", async () => {
    const { db } = createDb([
      storeRow("soon", { subscriptionExpiresAt: new Date(now.getTime() + 6 * 60 * 60 * 1000) }),
      storeRow("later", { subscriptionExpiresAt: new Date(now.getTime() + 20 * 60 * 60 * 1000) }),
    ]);
    const due = await listStoresNeedingReminder(db as never, { now, reminderHours: 12 });
    expect(due.map((row) => row.id)).toEqual(["soon"]);
  });

  it("suspends a store without deleting it", async () => {
    const { db, stores } = createDb([storeRow("s1")]);
    await setStoreEnabled(db as never, { storeId: "s1", actorTelegramId: "admin", enabled: false });
    expect(stores.get("s1")?.botEnabled).toBe(false);
  });

  it("computes expected monthly revenue from open stores", () => {
    expect(
      expectedMonthlyRevenue(
        [
          { botEnabled: true, subscriptionStatus: "ACTIVE" },
          { botEnabled: true, subscriptionStatus: "TRIAL" },
          { botEnabled: false, subscriptionStatus: "ACTIVE" },
          { botEnabled: true, subscriptionStatus: "EXPIRED" },
        ],
        129,
      ),
    ).toEqual({ activeStores: 2, expectedMonthly: 258 });
  });
});
