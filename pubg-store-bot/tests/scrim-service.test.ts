import { describe, expect, it } from "vitest";
import {
  addTeamManual,
  commitTeam,
  confirmRoomResult,
  createScrimDraft,
  ensureScrimTemplate,
  finalizeScrim,
  joinWaitlist,
  markTeamNoShow,
  maybeLockIfFull,
  proposeRoomResult,
  rankingForScrim,
  reviewTeamProof,
  startTeamJoin,
  submitTeamProof,
  withdrawTeam,
} from "../src/services/scrim";

type Row = Record<string, unknown>;

function createMemDb() {
  const templates = new Map<string, Row>();
  const scrims = new Map<string, Row>();
  const teams = new Map<string, Row>();
  const rooms = new Map<string, Row>();
  const records = new Map<string, Row>();
  let seq = 1;
  const id = (prefix: string) => `${prefix}-${seq++}`;

  const attach = (scrim: Row) => ({
    ...scrim,
    teams: [...teams.values()].filter((team) => team.scrimId === scrim.id),
    rooms: [...rooms.values()].filter((room) => room.scrimId === scrim.id),
  });

  const db = {
    scrimTemplate: {
      upsert: async ({ where, create }: { where: { storeId: string }; create: Row }) => {
        const existing = templates.get(where.storeId);
        if (existing) return existing;
        const row = { id: id("tpl"), moderatorTelegramIds: [], autoApproveProof: false, ...create };
        templates.set(where.storeId, row);
        return row;
      },
      update: async ({ where, data }: { where: { storeId: string }; data: Row }) => {
        const row = { ...templates.get(where.storeId), ...data };
        templates.set(where.storeId, row);
        return row;
      },
    },
    scrim: {
      findFirst: async ({
        where,
      }: {
        where: { id?: string; storeId?: string; status?: { in: string[] } };
      }) => {
        const rows = [...scrims.values()].filter((row) => {
          if (where.id && row.id !== where.id) return false;
          if (where.storeId && row.storeId !== where.storeId) return false;
          if (where.status?.in && !where.status.in.includes(row.status as string)) return false;
          return true;
        });
        rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
        return rows[0] ? attach(rows[0]) : null;
      },
      create: async ({ data }: { data: Row }) => {
        const row = { id: id("scrim"), status: "DRAFT", rosterDraft: "", createdAt: new Date().toISOString(), ...data };
        scrims.set(row.id as string, row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => {
        const row = { ...scrims.get(where.id), ...data };
        scrims.set(where.id, row);
        return attach(row);
      },
      delete: async ({ where }: { where: { id: string } }) => {
        scrims.delete(where.id);
      },
    },
    scrimRoom: {
      createMany: async ({ data }: { data: Row[] }) => {
        for (const item of data) {
          const row = { id: id("room"), roomTelegramId: "", roomPassword: "", publishedAt: null, confirmedAt: null, resultJson: null, ...item };
          rooms.set(row.id as string, row);
        }
      },
      deleteMany: async ({ where }: { where: { scrimId: string } }) => {
        for (const [key, row] of rooms) {
          if (row.scrimId === where.scrimId) rooms.delete(key);
        }
      },
      findFirst: async ({ where }: { where: { id: string; storeId: string } }) => {
        const row = [...rooms.values()].find((item) => item.id === where.id && item.storeId === where.storeId);
        if (!row) return null;
        const scrim = scrims.get(row.scrimId as string);
        return { ...row, scrim: scrim ? attach(scrim) : null };
      },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => {
        const row = { ...rooms.get(where.id), ...data };
        rooms.set(where.id, row);
        return row;
      },
    },
    scrimTeam: {
      create: async ({ data }: { data: Row }) => {
        const row = { id: id("team"), rosterSlot: null, waitlistSlot: null, committedAt: null, proofPhotoFileId: null, ...data };
        teams.set(row.id as string, row);
        return row;
      },
      deleteMany: async ({ where }: { where: { scrimId: string } }) => {
        for (const [key, row] of teams) {
          if (row.scrimId === where.scrimId) teams.delete(key);
        }
      },
      findFirst: async ({
        where,
      }: {
        where: {
          id?: string;
          storeId?: string;
          leaderTelegramId?: string;
          status?: { in: string[] };
          scrimId?: string;
        };
      }) => {
        const row = [...teams.values()].find((item) => {
          if (where.id && item.id !== where.id) return false;
          if (where.storeId && item.storeId !== where.storeId) return false;
          if (where.leaderTelegramId && item.leaderTelegramId !== where.leaderTelegramId) return false;
          if (where.scrimId && item.scrimId !== where.scrimId) return false;
          if (where.status?.in && !where.status.in.includes(item.status as string)) return false;
          return true;
        });
        if (!row) return null;
        const scrim = scrims.get(row.scrimId as string);
        return { ...row, scrim: scrim ? attach(scrim) : null };
      },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => {
        const row = { ...teams.get(where.id), ...data };
        teams.set(where.id, row);
        return row;
      },
    },
    teamRecord: {
      findUnique: async ({ where }: { where: { storeId_tag: { storeId: string; tag: string } } }) => {
        return records.get(`${where.storeId_tag.storeId}:${where.storeId_tag.tag}`) ?? null;
      },
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { storeId_tag: { storeId: string; tag: string } };
        create: Row;
        update: Row;
      }) => {
        const key = `${where.storeId_tag.storeId}:${where.storeId_tag.tag}`;
        const existing = records.get(key);
        if (!existing) {
          const row = { id: id("rec"), ...create };
          records.set(key, row);
          return row;
        }
        const next = { ...existing };
        for (const [field, value] of Object.entries(update)) {
          if (value && typeof value === "object" && "increment" in (value as object)) {
            next[field] = Number(existing[field] ?? 0) + Number((value as { increment: number }).increment);
          } else {
            next[field] = value;
          }
        }
        records.set(key, next);
        return next;
      },
    },
  };

  return { db: db as never, records };
}

const storeId = "store-1";

async function openScrim(db: never, maxTeams: 16 | 18 = 16) {
  const draft = await createScrimDraft(db, {
    storeId,
    openedByTelegramId: "owner",
    kind: "GULF",
    scheduledAtLabel: "الساعة 10 الليلة",
    maxTeams,
    roomCount: 2,
    roomSecret: "4455",
  });
  const scrim = await (db as { scrim: { update: Function } }).scrim.update({
    where: { id: draft.id },
    data: { status: "OPEN" },
  });
  return scrim as { id: string; maxTeams: number; teams: unknown[]; rooms: Array<{ id: string; index: number }> };
}

describe("scrim registration and lock", () => {
  it("registers a trusted tag without proof and locks at 16", async () => {
    const { db, records } = createMemDb();
    await ensureScrimTemplate(db, storeId);
    records.set(`${storeId}:AAA`, { storeId, tag: "AAA", attended: 2, absent: 0, participations: 2, trust: "TRUSTED" });
    const scrim = await openScrim(db, 16);

    const join = await startTeamJoin(db, { storeId, scrimId: scrim.id, leaderTelegramId: "u1", tag: "aaa" });
    expect(join.outcome).toBe("need_commit");
    const committed = await commitTeam(db, { storeId, leaderTelegramId: "u1", phrase: "ملتزمين", scrimId: scrim.id });
    expect(committed.waitlisted).toBe(false);
    expect(committed.ack).toContain("4455");

    const dup = await startTeamJoin(db, { storeId, scrimId: scrim.id, leaderTelegramId: "u2", tag: "AAA" });
    expect(dup.outcome).toBe("duplicate");

    for (let i = 2; i <= 16; i += 1) {
      const tag = `T${String(i).padStart(2, "0")}`;
      await addTeamManual(db, { storeId, scrimId: scrim.id, tag });
    }
    const lock = await maybeLockIfFull(db, storeId, scrim.id);
    expect(lock.scrim.status).toBe("LOCKED");
    expect(lock.scrim.teams.filter((team: { status: string }) => team.status === "CONFIRMED")).toHaveLength(16);

    const afterLock = await startTeamJoin(db, { storeId, scrimId: scrim.id, leaderTelegramId: "late", tag: "LATE" });
    expect(afterLock.outcome).toBe("need_proof");
  });

  it("locks at 18", async () => {
    const { db } = createMemDb();
    await ensureScrimTemplate(db, storeId);
    const scrim = await openScrim(db, 18);
    for (let i = 1; i <= 18; i += 1) {
      await addTeamManual(db, { storeId, scrimId: scrim.id, tag: `P${String(i).padStart(2, "0")}` });
    }
    const lock = await maybeLockIfFull(db, storeId, scrim.id);
    expect(lock.scrim.status).toBe("LOCKED");
    expect(lock.scrim.teams.filter((team: { status: string }) => team.status === "CONFIRMED")).toHaveLength(18);
  });
});

describe("scrim verification and waitlist", () => {
  it("asks new and absent teams for proof, then waitlist promotes on withdraw", async () => {
    const { db, records } = createMemDb();
    await ensureScrimTemplate(db, storeId);
    records.set(`${storeId}:OLD`, { storeId, tag: "OLD", attended: 1, absent: 1, participations: 2, trust: "ABSENT" });
    const scrim = await openScrim(db, 16);

    const fresh = await startTeamJoin(db, { storeId, scrimId: scrim.id, leaderTelegramId: "n1", tag: "NEW1" });
    expect(fresh.outcome).toBe("need_proof");
    if (fresh.outcome !== "need_proof") throw new Error("expected proof");
    await submitTeamProof(db, { storeId, teamId: fresh.teamId, photoFileId: "photo-1" });
    const reviewed = await reviewTeamProof(db, {
      storeId,
      teamId: fresh.teamId,
      actorTelegramId: "owner",
      accept: true,
    });
    expect(reviewed.next).toBe("commit");

    const absent = await startTeamJoin(db, { storeId, scrimId: scrim.id, leaderTelegramId: "n2", tag: "OLD" });
    expect(absent.outcome).toBe("need_proof");

    for (let i = 1; i <= 16; i += 1) {
      await addTeamManual(db, { storeId, scrimId: scrim.id, tag: `F${String(i).padStart(2, "0")}` });
    }
    records.set(`${storeId}:WAIT`, { storeId, tag: "WAIT", attended: 3, absent: 0, participations: 3, trust: "TRUSTED" });
    const extra = await startTeamJoin(db, { storeId, scrimId: scrim.id, leaderTelegramId: "w1", tag: "WAIT" });
    expect(extra.outcome).toBe("waitlist_offer");
    if (extra.outcome !== "waitlist_offer") throw new Error("expected waitlist");
    await joinWaitlist(db, { storeId, teamId: extra.teamId, leaderTelegramId: "w1" });

    const result = await withdrawTeam(db, { storeId, scrimId: scrim.id, tagOrId: "F01" });
    expect(result.promoted?.tag).toBe("WAIT");
  });
});

describe("scrim results and ranking", () => {
  it("stores confirmed standings and cumulative ranking, then attendance records", async () => {
    const { db, records } = createMemDb();
    await ensureScrimTemplate(db, storeId);
    const scrim = await openScrim(db, 16);
    await addTeamManual(db, { storeId, scrimId: scrim.id, tag: "AAA" });
    await addTeamManual(db, { storeId, scrimId: scrim.id, tag: "BBB" });
    const roomA = scrim.rooms.find((room) => room.index === 1)!;
    const roomB = scrim.rooms.find((room) => room.index === 2)!;

    await proposeRoomResult(db, {
      storeId,
      roomId: roomA.id,
      photoFileId: "r1",
      parsed: {
        rows: [
          { place: 1, tag: "AAA", kills: 10 },
          { place: 2, tag: "BBB", kills: 4 },
        ],
        topKiller: { name: "wolf", tag: "AAA", kills: 10 },
      },
    });
    await confirmRoomResult(db, { storeId, roomId: roomA.id });
    await proposeRoomResult(db, {
      storeId,
      roomId: roomB.id,
      photoFileId: "r2",
      parsed: {
        rows: [
          { place: 1, tag: "BBB", kills: 8 },
          { place: 2, tag: "AAA", kills: 2 },
        ],
        topKiller: { name: "fox", tag: "BBB", kills: 8 },
      },
    });
    await confirmRoomResult(db, { storeId, roomId: roomB.id });

    await expect(
      proposeRoomResult(db, { storeId, roomId: roomA.id, photoFileId: "x", parsed: null }),
    ).rejects.toMatchObject({ userMessage: expect.stringMatching(/ما قدرت أقرأ/) });

    const ranked = await rankingForScrim(db, storeId, scrim.id);
    expect(ranked[0]?.tag).toBe("AAA");
    expect(ranked[0]?.points).toBe(20 + 8);
    expect(ranked[1]?.tag).toBe("BBB");

    await markTeamNoShow(db, { storeId, scrimId: scrim.id, tag: "BBB" });
    expect(records.get(`${storeId}:BBB`)?.trust).toBe("ABSENT");

    const done = await finalizeScrim(db, storeId, scrim.id);
    expect(done.caption).toContain("شكرًا");
    expect(records.get(`${storeId}:AAA`)?.trust).toBe("TRUSTED");
    expect(records.get(`${storeId}:AAA`)?.attended).toBe(1);
  });
});
