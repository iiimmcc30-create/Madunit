import { describe, expect, it } from "vitest";
import {
  bindStoreToTradersGroup,
  listStoresForTradersGroup,
  resolveTradersMirrorStores,
  storeMatchesTradersChat,
} from "./traders-mirror";

type StoreRow = {
  id: string;
  channelId: string | null;
  tradersGroupId: string | null;
  ownerUsername: string;
  ownerTelegramId: string;
  botUsername: string;
};

function makeDb(stores: Map<string, StoreRow>) {
  return {
    store: {
      async update({
        where,
        data,
      }: {
        where: { id: string };
        data: { tradersGroupId: string | null };
      }) {
        const row = stores.get(where.id);
        if (!row) throw new Error("missing store");
        row.tradersGroupId = data.tradersGroupId;
        return row;
      },
      async updateMany({
        where,
        data,
      }: {
        where: { tradersGroupId: string; NOT?: { id: string } };
        data: { tradersGroupId: string | null };
      }) {
        let count = 0;
        for (const row of stores.values()) {
          if (row.tradersGroupId !== where.tradersGroupId) continue;
          if (where.NOT?.id && row.id === where.NOT.id) continue;
          row.tradersGroupId = data.tradersGroupId;
          count += 1;
        }
        return { count };
      },
      async findMany({
        where,
      }: {
        where: { tradersGroupId: string };
      }) {
        return [...stores.values()].filter(
          (s) => s.tradersGroupId === where.tradersGroupId,
        );
      },
    },
  };
}

const GROUP = "-1001348507570";

function seedPeerStores(): Map<string, StoreRow> {
  const stores = new Map<string, StoreRow>();
  stores.set("sultan", {
    id: "sultan",
    channelId: "-100111",
    tradersGroupId: GROUP,
    ownerUsername: "sultan_owner",
    ownerTelegramId: "1",
    botUsername: "Sultan_SL_Bot",
  });
  stores.set("dmstor", {
    id: "dmstor",
    channelId: "-100222",
    tradersGroupId: null,
    ownerUsername: "dm_owner",
    ownerTelegramId: "2",
    botUsername: "DMSTOR_bot",
  });
  return stores;
}

describe("multi-store traders bind", () => {
  it("bindStoreToTradersGroup sets only the calling store and keeps peer binding", async () => {
    const stores = seedPeerStores();
    const db = makeDb(stores);

    await bindStoreToTradersGroup(db as never, "dmstor", GROUP);

    expect(stores.get("dmstor")!.tradersGroupId).toBe(GROUP);
    expect(stores.get("sultan")!.tradersGroupId).toBe(GROUP);
  });

  it("rebinding one store to a different group does not clear the peer", async () => {
    const stores = seedPeerStores();
    stores.get("dmstor")!.tradersGroupId = GROUP;
    const db = makeDb(stores);

    await bindStoreToTradersGroup(db as never, "dmstor", "-100999");

    expect(stores.get("dmstor")!.tradersGroupId).toBe("-100999");
    expect(stores.get("sultan")!.tradersGroupId).toBe(GROUP);
  });

  it("listStoresForTradersGroup returns every store sharing the group", async () => {
    const stores = seedPeerStores();
    stores.get("dmstor")!.tradersGroupId = GROUP;
    const db = makeDb(stores);

    const rows = await listStoresForTradersGroup(db as never, GROUP);
    expect(rows.map((r) => r.id).sort()).toEqual(["dmstor", "sultan"]);
  });
});

describe("multi-store traders mirror resolve", () => {
  it("resolveTradersMirrorStores returns all allowlisted peers for the chat", async () => {
    const stores = seedPeerStores();
    stores.get("dmstor")!.tradersGroupId = GROUP;
    const db = makeDb(stores);
    const deps = {
      db,
      storeId: "sultan",
      botUsername: "Sultan_SL_Bot",
    };

    const matched = await resolveTradersMirrorStores(deps as never, GROUP);
    expect(matched.map((r) => r.id).sort()).toEqual(["dmstor", "sultan"]);
  });

  it("each bot only matches its own store among shared-group peers", () => {
    const sultan = {
      id: "sultan",
      channelId: "-100111",
      tradersGroupId: GROUP,
      ownerUsername: "sultan_owner",
      ownerTelegramId: "1",
      botUsername: "Sultan_SL_Bot",
    };
    const dmstor = {
      id: "dmstor",
      channelId: "-100222",
      tradersGroupId: GROUP,
      ownerUsername: "dm_owner",
      ownerTelegramId: "2",
      botUsername: "DMSTOR_bot",
    };

    expect(storeMatchesTradersChat(sultan, GROUP, "Sultan_SL_Bot")).toBe(true);
    expect(storeMatchesTradersChat(dmstor, GROUP, "DMSTOR_bot")).toBe(true);
    expect(storeMatchesTradersChat(sultan, "-100999", "Sultan_SL_Bot")).toBe(false);
    expect(storeMatchesTradersChat({ ...dmstor, tradersGroupId: null }, GROUP, "DMSTOR_bot")).toBe(
      false,
    );
  });
});
