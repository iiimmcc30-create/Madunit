import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { AppError, ConflictError } from "../src/domain/errors";
import { assertBotIsChannelAdmin, bindStoreChannel } from "../src/services/platform";

function storeRow(id: string, patch: Record<string, unknown> = {}) {
  return {
    id,
    channelId: null as string | null,
    title: "متجر",
    ownerUsername: "",
    ownerTelegramId: "",
    botTelegramId: "99",
    botUsername: "shopbot",
    botFirstName: "Shop",
    tokenCipher: "cipher",
    webhookSecret: "secret",
    botEnabled: true,
    listingTemplate: "tpl",
    listingFee: new Prisma.Decimal(0),
    paymentInstructions: "",
    coverTheme: {},
    coverEnabled: false,
    customGlossary: [],
    publishMode: "AUTO" as const,
    listingSeq: 0,
    plan: "MONTHLY" as const,
    subscriptionStatus: "TRIAL" as const,
    subscriptionExpiresAt: new Date("2026-10-15T00:00:00.000Z"),
    subscriptionRemindedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...patch,
  };
}

function createDb(rows: ReturnType<typeof storeRow>[], claimRows: Array<{ kind: string; value: string; storeId: string }> = []) {
  const stores = new Map(rows.map((row) => [row.id, row]));
  const claims = new Map(claimRows.map((row) => [`${row.kind}:${row.value}`, { ...row }]));
  const db = {
    store: {
      findUnique: async ({
        where,
      }: {
        where: { id?: string; channelId?: string };
      }) => {
        if (where.id) return stores.get(where.id) ?? null;
        if (where.channelId) {
          return [...stores.values()].find((row) => row.channelId === where.channelId) ?? null;
        }
        return null;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = stores.get(where.id);
        if (!row) return null;
        Object.assign(row, data);
        return row;
      },
    },
    trialClaim: {
      findUnique: async ({
        where,
      }: {
        where: { kind_value: { kind: string; value: string } };
      }) => claims.get(`${where.kind_value.kind}:${where.kind_value.value}`) ?? null,
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { kind_value: { kind: string; value: string } };
        create: { kind: string; value: string; storeId: string };
        update: { storeId: string };
      }) => {
        const key = `${where.kind_value.kind}:${where.kind_value.value}`;
        const existing = claims.get(key);
        if (!existing) {
          const row = { id: key, ...create };
          claims.set(key, row);
          return row;
        }
        Object.assign(existing, update);
        return existing;
      },
    },
    auditLog: { create: async () => ({}) },
  };
  return { db, stores, claims };
}

const api = {
  getMe: async () => ({ id: 99, username: "shopbot" }),
  getChat: async () => ({ id: -100111, type: "channel" as const }),
  getChatMember: async () => ({ status: "administrator", can_post_messages: true }),
};

describe("platform channel bind", () => {
  it("grants a first-time owner the existing trial", async () => {
    const { db, stores, claims } = createDb([storeRow("s1")]);
    const result = await bindStoreChannel(db as never, api as never, {
      storeId: "s1",
      channelId: "-100111",
      actorTelegramId: "owner-1",
      actorUsername: "shop_owner",
      trialHours: 48,
    });
    expect(result.reusedTrial).toBe(false);
    expect(result.store.subscriptionStatus).toBe("TRIAL");
    expect(stores.get("s1")?.channelId).toBe("-100111");
    expect(claims.get("owner:owner-1")?.storeId).toBe("s1");
    expect(claims.get("channel:-100111")?.storeId).toBe("s1");
  });

  it("blocks repeating a trial for the same owner", async () => {
    const { db, stores } = createDb(
      [storeRow("s2", { ownerTelegramId: "owner-1", ownerUsername: "shop_owner" })],
      [{ kind: "owner", value: "owner-1", storeId: "s1" }],
    );
    const result = await bindStoreChannel(db as never, api as never, {
      storeId: "s2",
      channelId: "-100222",
      actorTelegramId: "owner-1",
      actorUsername: "shop_owner",
      trialHours: 48,
      now: new Date("2026-10-13T12:00:00.000Z"),
    });
    expect(result.reusedTrial).toBe(true);
    expect(stores.get("s2")?.subscriptionStatus).toBe("EXPIRED");
  });

  it("rejects a channel already claimed by another store", async () => {
    const { db } = createDb(
      [storeRow("s2"), storeRow("s1", { channelId: "-100111" })],
      [{ kind: "channel", value: "-100111", storeId: "s1" }],
    );
    await expect(
      bindStoreChannel(db as never, api as never, {
        storeId: "s2",
        channelId: "-100111",
        actorTelegramId: "owner-2",
        trialHours: 48,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("names the missing post permission when the bot is admin without publish", async () => {
    const noPost = {
      ...api,
      getChatMember: async () => ({ status: "administrator", can_post_messages: false }),
    };
    await expect(assertBotIsChannelAdmin(noPost as never, "-100111")).rejects.toMatchObject({
      code: "BOT_NOT_ADMIN",
    });
    try {
      await assertBotIsChannelAdmin(noPost as never, "-100111");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).userMessage).toContain("نشر الرسائل");
    }
  });
});
