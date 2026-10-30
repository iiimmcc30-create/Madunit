import type { Prisma, PrismaClient, ScrimKind, ScrimStatus, ScrimTeamStatus } from "@prisma/client";
import { AppError, ConflictError, NotFoundError } from "../domain/errors";
import {
  dayLabel,
  defaultScrimTemplateFields,
  formatRosterLines,
  openCaptionFor,
  openTemplateVars,
  renderScrimTemplate,
} from "../domain/scrim-defaults";
import {
  canTakeConfirmedSlot,
  duplicateTag,
  firstWaitlist,
  isAllowedMaxTeams,
  nextRosterSlot,
  nextWaitlistSlot,
  shouldLockRegistration,
  teamNeedsProof,
} from "../domain/scrim-flow";
import { formatStandingsLines, parseScrimRoomResult } from "../domain/scrim-parse";
import { accumulateTeamScores, formatRanking } from "../domain/scrim-score";
import { isCommitPhrase, normalizeScrimTag } from "../domain/scrim-tag";
import { parseScrimStartTime } from "../domain/scrim-time";
import { mapEmoji, mapForRoom } from "../domain/scrim-maps";
import { stripPasswordLines } from "../domain/scrim-room-post";
import {
  kindLabel,
  parseMaxTeams,
  parseRoomCount,
  parseScoring,
  type RoomCredentials,
  type ScrimOpenExtract,
  type ScrimRoomResult,
} from "../domain/scrim-types";

export { parseScrimRoomResult };

type Db = PrismaClient;

export type ScrimWithRelations = Prisma.ScrimGetPayload<{
  include: { teams: true; rooms: true };
}>;

export type ScrimTemplateView = Prisma.ScrimTemplateGetPayload<object>;

const ACTIVE_STATUSES: ScrimStatus[] = ["DRAFT", "OPEN", "LOCKED", "LIVE"];

function notFound(id: string): never {
  throw new NotFoundError("scrim", id, "ما لقيت هالسكرم.");
}

export async function ensureScrimTemplate(db: Db, storeId: string): Promise<ScrimTemplateView> {
  const defaults = defaultScrimTemplateFields();
  return db.scrimTemplate.upsert({
    where: { storeId },
    create: {
      storeId,
      ...defaults,
      scoring: defaults.scoring as Prisma.InputJsonValue,
    },
    update: {},
  });
}

export function isScrimOperator(
  storeOwnerTelegramId: string,
  actorTelegramId: string,
  superAdminId: string,
  moderatorIds: string[],
): boolean {
  if (actorTelegramId === superAdminId) return true;
  if (storeOwnerTelegramId && actorTelegramId === storeOwnerTelegramId) return true;
  return moderatorIds.includes(actorTelegramId);
}

type OpenInput = {
  kind: ScrimKind;
  scheduledAtLabel: string;
  maxTeams: number;
  roomCount: number;
  rules: string;
  maps?: string[];
  startsAt?: Date | null;
};

function openVars(input: OpenInput) {
  const maps = input.maps ?? [];
  return openTemplateVars({
    kind: input.kind,
    timeLabel: input.scheduledAtLabel,
    maxTeams: input.maxTeams,
    roomCount: input.roomCount,
    rules: renderScrimTemplate(input.rules, {
      عدد_الرومات: String(input.roomCount),
      عدد_الفرق: String(input.maxTeams),
      الخرائط: maps.join(", "),
    }),
    maps,
    dayLabel: dayLabel(input.startsAt),
  });
}

export function renderOpenCaption(
  template: Pick<ScrimTemplateView, "openCaptionEurope" | "openCaptionGulf">,
  input: OpenInput,
): string {
  const body = openCaptionFor(input.kind, template.openCaptionEurope, template.openCaptionGulf);
  return renderScrimTemplate(body, openVars(input));
}

/** Optional second channel message right after the open post (Mad Unit style details). */
export function renderOpenDetails(template: Pick<ScrimTemplateView, "openDetailsText">, input: OpenInput): string {
  if (!template.openDetailsText?.trim()) return "";
  return renderScrimTemplate(template.openDetailsText, openVars(input));
}

export function renderLockCaption(
  template: Pick<ScrimTemplateView, "lockText">,
  maxTeams: number,
): string {
  return renderScrimTemplate(template.lockText, { عدد_الفرق: String(maxTeams) });
}

export function renderRosterCaption(
  template: Pick<ScrimTemplateView, "rosterTemplate"> &
    Partial<Pick<ScrimTemplateView, "rosterLineFormat" | "rosterStartSlot" | "rosterShowEmpty">>,
  scrim: Pick<ScrimWithRelations, "kind" | "scheduledAtLabel" | "rules" | "teams"> &
    Partial<Pick<ScrimWithRelations, "maxTeams" | "maps" | "startsAt" | "roomCount">>,
  options: { forceEmptySlots?: boolean } = {},
): string {
  const lines = formatRosterLines(
    scrim.teams
      .filter((team) => team.status === "CONFIRMED" && team.rosterSlot != null)
      .map((team) => ({ slot: team.rosterSlot as number, tag: team.tag })),
    {
      lineFormat: template.rosterLineFormat,
      startSlot: template.rosterStartSlot ?? 1,
      totalSlots: scrim.maxTeams,
      showEmpty: Boolean(template.rosterShowEmpty || options.forceEmptySlots),
    },
  );
  return renderScrimTemplate(template.rosterTemplate, {
    النوع: kindLabel(scrim.kind),
    الوقت: scrim.scheduledAtLabel,
    الشروط: scrim.rules,
    اللستة: lines,
    الخرائط: (scrim.maps ?? []).join(", "),
    اليوم: dayLabel(scrim.startsAt),
    عدد_الفرق: String(scrim.maxTeams ?? ""),
    عدد_الرومات: String(scrim.roomCount ?? ""),
  });
}

export function renderCommitAck(
  template: Pick<ScrimTemplateView, "commitAckText">,
  roomSecret: string,
): string {
  const text = renderScrimTemplate(template.commitAckText, { السر: roomSecret });
  if (roomSecret && !text.includes(roomSecret)) {
    return `${text}\nالرقم السري للروم: ${roomSecret}`;
  }
  return text;
}

export function renderRoomIdCaption(
  template: Pick<ScrimTemplateView, "roomIdText">,
  creds: RoomCredentials,
  room: { index?: number; maps?: readonly string[] } = {},
): string {
  const map = room.index ? mapForRoom(room.maps ?? [], room.index) : "";
  return renderScrimTemplate(template.roomIdText, {
    id: creds.roomId,
    pass: creds.password,
    الخريطة: map,
    map,
    رمز_الخريطة: map ? mapEmoji(map) : "",
    رقم_الروم: room.index ? String(room.index) : "",
  });
}

export function renderRoomResultCaption(
  template: Pick<ScrimTemplateView, "roomResultTemplate">,
  roomIndex: number,
  result: ScrimRoomResult,
  maps?: readonly string[],
): string {
  const first = result.rows.find((row) => row.place === 1);
  const killer = result.topKiller;
  const map = mapForRoom(maps ?? [], roomIndex);
  return renderScrimTemplate(template.roomResultTemplate, {
    رقم_الروم: String(roomIndex),
    كيلات_الأول: first ? String(first.kills) : "—",
    الخريطة: map,
    الأول: first ? `${first.tag}` : "—",
    أكثر_كيلات: killer ? `${killer.name}` : "—",
    عدد_الكيلات: killer ? String(killer.kills) : "—",
    الخمسة: formatStandingsLines(result),
  });
}

export function renderFinalCaption(
  template: Pick<ScrimTemplateView, "thanksText">,
  ranking: string,
  champion = "",
): string {
  return `${ranking}\n\n${renderScrimTemplate(template.thanksText, { البطل: champion || "—" })}`;
}

async function loadScrim(db: Db, storeId: string, scrimId: string): Promise<ScrimWithRelations> {
  const scrim = await db.scrim.findFirst({
    where: { id: scrimId, storeId },
    include: { teams: true, rooms: true },
  });
  if (!scrim) notFound(scrimId);
  return scrim;
}

async function activeScrim(db: Db, storeId: string): Promise<ScrimWithRelations | null> {
  return db.scrim.findFirst({
    where: { storeId, status: { in: ACTIVE_STATUSES } },
    include: { teams: true, rooms: true },
    orderBy: { createdAt: "desc" },
  });
}

async function findScrimByStatuses(
  db: Db,
  storeId: string,
  statuses: ScrimStatus[],
  scrimId?: string,
): Promise<ScrimWithRelations | null> {
  if (scrimId) {
    return db.scrim.findFirst({
      where: { id: scrimId, storeId },
      include: { teams: true, rooms: true },
    });
  }
  return db.scrim.findFirst({
    where: { storeId, status: { in: statuses } },
    include: { teams: true, rooms: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function findJoinableScrim(db: Db, storeId: string, scrimId?: string): Promise<ScrimWithRelations | null> {
  return findScrimByStatuses(db, storeId, ["OPEN", "LOCKED"], scrimId);
}

export async function findActiveScrim(db: Db, storeId: string, scrimId?: string): Promise<ScrimWithRelations | null> {
  return findScrimByStatuses(db, storeId, ACTIVE_STATUSES, scrimId);
}

export async function listStoreScrims(db: Db, storeId?: string, take = 40) {
  return db.scrim.findMany({
    where: storeId ? { storeId } : undefined,
    include: {
      store: true,
      teams: true,
      rooms: true,
    },
    orderBy: { createdAt: "desc" },
    take,
  });
}

export async function updateScrimTemplate(
  db: Db,
  storeId: string,
  patch: Partial<{
    openPhotoFileId: string;
    openCaptionEurope: string;
    openCaptionGulf: string;
    defaultRules: string;
    commitAckText: string;
    committedPhrase: string;
    lockText: string;
    rosterTemplate: string;
    roomIdText: string;
    roomResultTemplate: string;
    thanksText: string;
    autoApproveProof: boolean;
    moderatorTelegramIds: string[];
    organizersGroupId: string | null;
    dropsGroupLink: string | null;
    postRoomPassToChannel: boolean;
    dropsGroupId: string | null;
    dropsUnlockLeadMinutes: number;
    scheduleEnabled: boolean;
    scheduleTime: string | null;
    scheduleKind: ScrimKind | null;
    scheduleMaxTeams: number;
    scheduleRoomCount: number;
    scheduleOpenLeadMinutes: number;
    scheduleLastRunKey: string | null;
    rosterStartSlot: number;
    roomIdChannelMode: string;
    roomIdLeadMinutes: number;
    rosterLineFormat: string;
    rosterShowEmpty: boolean;
    openDetailsText: string;
    defaultMaps: string[];
    scoring: Prisma.InputJsonValue | object;
  }>,
): Promise<ScrimTemplateView> {
  await ensureScrimTemplate(db, storeId);
  return db.scrimTemplate.update({
    where: { storeId },
    data: patch,
  });
}

export async function addScrimModerator(db: Db, storeId: string, telegramId: string) {
  const template = await ensureScrimTemplate(db, storeId);
  const id = telegramId.trim();
  if (!/^\d{3,20}$/.test(id)) {
    throw new AppError("bad mod", "أرسل آيدي تلقرام رقم واضح.", "INVALID_MOD");
  }
  if (template.moderatorTelegramIds.includes(id)) return template;
  return updateScrimTemplate(db, storeId, {
    moderatorTelegramIds: [...template.moderatorTelegramIds, id],
  });
}

export async function removeScrimModerator(db: Db, storeId: string, telegramId: string) {
  const template = await ensureScrimTemplate(db, storeId);
  return updateScrimTemplate(db, storeId, {
    moderatorTelegramIds: template.moderatorTelegramIds.filter((id) => id !== telegramId),
  });
}

export function validateOpenDraft(input: ScrimOpenExtract & { rules?: string | null }): {
  kind: ScrimKind;
  scheduledAtLabel: string;
  maxTeams: number;
  roomCount: number;
  roomSecret: string;
  rules: string;
  maps: string[];
} {
  const kind = input.kind;
  const maxTeams = parseMaxTeams(input.maxTeams);
  const roomCount = parseRoomCount(input.roomCount ?? 1) ?? 1;
  if (!kind) throw new AppError("need kind", "حدد نوع السكرم: خليجي أو أوروبي.", "SCRIM_KIND");
  if (!input.timeLabel?.trim()) throw new AppError("need time", "حدد وقت السكرم.", "SCRIM_TIME");
  if (!maxTeams) throw new AppError("need max", "عدد الفرق لازم من 2 إلى 25.", "SCRIM_MAX");
  if (!isAllowedMaxTeams(maxTeams)) throw new AppError("need max", "عدد الفرق لازم من 2 إلى 25.", "SCRIM_MAX");
  return {
    kind,
    scheduledAtLabel: input.timeLabel.trim(),
    maxTeams,
    roomCount,
    roomSecret: (input.roomSecret ?? "").trim(),
    rules: (input.rules ?? "").trim(),
    maps: input.maps ?? [],
  };
}

export async function createScrimDraft(
  db: Db,
  input: {
    storeId: string;
    openedByTelegramId: string;
    kind: ScrimKind;
    scheduledAtLabel: string;
    maxTeams: number;
    roomCount: number;
    roomSecret: string;
    rules?: string;
    startsAt?: Date | null;
    maps?: string[];
  },
): Promise<ScrimWithRelations> {
  const existing = await activeScrim(db, input.storeId);
  if (existing && existing.status !== "DRAFT") {
    throw new ConflictError("active scrim", "فيه سكرم جاري بهالقناة. أقفله أو أتمّه قبل فتح جديد.");
  }
  if (existing?.status === "DRAFT") {
    await db.scrimRoom.deleteMany({ where: { scrimId: existing.id } });
    await db.scrimTeam.deleteMany({ where: { scrimId: existing.id } });
    await db.scrim.delete({ where: { id: existing.id } });
  }
  const template = await ensureScrimTemplate(db, input.storeId);
  const created = await db.scrim.create({
    data: {
      storeId: input.storeId,
      kind: input.kind,
      status: "DRAFT",
      scheduledAtLabel: input.scheduledAtLabel,
      startsAt: input.startsAt ?? parseScrimStartTime(input.scheduledAtLabel, new Date()),
      maps: input.maps?.length ? input.maps : template.defaultMaps ?? [],
      maxTeams: input.maxTeams,
      roomCount: input.roomCount,
      roomSecret: input.roomSecret,
      rules: input.rules?.trim() || template.defaultRules,
      openedByTelegramId: input.openedByTelegramId,
    },
  });
  await db.scrimRoom.createMany({
    data: Array.from({ length: input.roomCount }, (_, index) => ({
      scrimId: created.id,
      storeId: input.storeId,
      index: index + 1,
    })),
  });
  return loadScrim(db, input.storeId, created.id);
}

export async function publishScrimOpen(
  db: Db,
  input: { storeId: string; scrimId: string; channelMessageId: string },
): Promise<ScrimWithRelations> {
  const scrim = await loadScrim(db, input.storeId, input.scrimId);
  if (scrim.status !== "DRAFT") {
    throw new ConflictError("not draft", "هالسكرم مفتوح أو منتهي.");
  }
  return db.scrim.update({
    where: { id: scrim.id },
    data: { status: "OPEN", channelOpenMessageId: input.channelMessageId },
    include: { teams: true, rooms: true },
  });
}

export async function cancelScrimDraft(db: Db, storeId: string, scrimId: string) {
  const scrim = await loadScrim(db, storeId, scrimId);
  if (scrim.status !== "DRAFT") {
    throw new ConflictError("not draft", "ما ينلغى إلا وهو مسودة.");
  }
  await db.scrim.update({ where: { id: scrim.id }, data: { status: "CANCELED" } });
}

async function lockScrim(db: Db, scrim: ScrimWithRelations, template: ScrimTemplateView) {
  const rosterDraft = renderRosterCaption(template, scrim);
  return db.scrim.update({
    where: { id: scrim.id },
    data: { status: "LOCKED", rosterDraft },
    include: { teams: true, rooms: true },
  });
}

export async function maybeLockIfFull(db: Db, storeId: string, scrimId: string) {
  const template = await ensureScrimTemplate(db, storeId);
  const scrim = await loadScrim(db, storeId, scrimId);
  if (scrim.status !== "OPEN") return { locked: false as const, scrim };
  if (!shouldLockRegistration(scrim.teams, scrim.maxTeams)) return { locked: false as const, scrim };
  const locked = await lockScrim(db, scrim, template);
  return { locked: true as const, scrim: locked, lockCaption: renderLockCaption(template, scrim.maxTeams) };
}

export async function lockScrimManual(db: Db, storeId: string, scrimId: string) {
  const template = await ensureScrimTemplate(db, storeId);
  const scrim = await loadScrim(db, storeId, scrimId);
  if (scrim.status !== "OPEN") {
    throw new ConflictError("not open", "التسجيل مو مفتوح.");
  }
  const locked = await lockScrim(db, scrim, template);
  return { scrim: locked, lockCaption: renderLockCaption(template, scrim.maxTeams) };
}

export async function saveRosterDraft(db: Db, storeId: string, scrimId: string, draft: string) {
  await loadScrim(db, storeId, scrimId);
  return db.scrim.update({
    where: { id: scrimId },
    data: { rosterDraft: draft },
    include: { teams: true, rooms: true },
  });
}

export async function markRosterPublished(db: Db, storeId: string, scrimId: string, channelMessageId: string) {
  await loadScrim(db, storeId, scrimId);
  return db.scrim.update({
    where: { id: scrimId },
    data: { channelRosterMessageId: channelMessageId },
    include: { teams: true, rooms: true },
  });
}

export async function markLockPublished(db: Db, storeId: string, scrimId: string, channelMessageId: string) {
  await loadScrim(db, storeId, scrimId);
  return db.scrim.update({
    where: { id: scrimId },
    data: { channelLockMessageId: channelMessageId },
    include: { teams: true, rooms: true },
  });
}

export type JoinDecision =
  | { outcome: "need_tag" }
  | { outcome: "need_proof"; teamId: string; tag: string }
  | { outcome: "need_commit"; teamId: string; tag: string }
  | { outcome: "waitlist_offer"; teamId: string; tag: string }
  | { outcome: "locked" }
  | { outcome: "duplicate" }
  | { outcome: "already"; teamId: string; status: ScrimTeamStatus };

export async function startTeamJoin(
  db: Db,
  input: { storeId: string; scrimId: string; leaderTelegramId: string; tag: string },
): Promise<JoinDecision> {
  const scrim = await loadScrim(db, input.storeId, input.scrimId);
  if (scrim.status !== "OPEN" && scrim.status !== "LOCKED") return { outcome: "locked" };
  const tag = normalizeScrimTag(input.tag);
  if (!tag) throw new AppError("bad tag", "أرسل تاق الفريق واضح (حروف وأرقام).", "SCRIM_TAG");
  const existing = scrim.teams.find((team) => team.leaderTelegramId === input.leaderTelegramId && team.status !== "REJECTED" && team.status !== "WITHDRAWN");
  if (existing) {
    if (existing.status === "PENDING_PROOF") return { outcome: "need_proof", teamId: existing.id, tag: existing.tag };
    if (existing.status === "WAITING_COMMIT") return { outcome: "need_commit", teamId: existing.id, tag: existing.tag };
    if (existing.status === "WAITLIST") return { outcome: "waitlist_offer", teamId: existing.id, tag: existing.tag };
    return { outcome: "already", teamId: existing.id, status: existing.status };
  }
  if (duplicateTag(scrim.teams, tag)) return { outcome: "duplicate" };

  const record = await db.teamRecord.findUnique({
    where: { storeId_tag: { storeId: input.storeId, tag } },
  });
  const needsProof = teamNeedsProof(record);
  const openSlot = scrim.status === "OPEN" && canTakeConfirmedSlot(scrim.teams, scrim.maxTeams);
  const created = await db.scrimTeam.create({
    data: {
      scrimId: scrim.id,
      storeId: input.storeId,
      tag,
      leaderTelegramId: input.leaderTelegramId,
      status: needsProof ? "PENDING_PROOF" : openSlot ? "WAITING_COMMIT" : "WAITLIST",
      waitlistSlot: needsProof || openSlot ? null : nextWaitlistSlot(scrim.teams),
    },
  });
  if (needsProof) return { outcome: "need_proof", teamId: created.id, tag };
  if (!openSlot) return { outcome: "waitlist_offer", teamId: created.id, tag };
  return { outcome: "need_commit", teamId: created.id, tag };
}

export async function submitTeamProof(db: Db, input: { storeId: string; teamId: string; photoFileId: string }) {
  const team = await db.scrimTeam.findFirst({
    where: { id: input.teamId, storeId: input.storeId },
    include: { scrim: { include: { teams: true, rooms: true } } },
  });
  if (!team) throw new NotFoundError("team", input.teamId, "ما لقيت طلب التسجيل.");
  if (team.status !== "PENDING_PROOF") {
    throw new ConflictError("not pending", "هالطلب مو بانتظار صورة تحقق.");
  }
  const template = await ensureScrimTemplate(db, input.storeId);
  const updated = await db.scrimTeam.update({
    where: { id: team.id },
    data: { proofPhotoFileId: input.photoFileId },
  });
  if (template.autoApproveProof) {
    return reviewTeamProof(db, {
      storeId: input.storeId,
      teamId: team.id,
      actorTelegramId: "auto",
      accept: true,
    });
  }
  return { autoApproved: false as const, team: updated, scrim: team.scrim };
}

export async function reviewTeamProof(
  db: Db,
  input: { storeId: string; teamId: string; actorTelegramId: string; accept: boolean },
) {
  const team = await db.scrimTeam.findFirst({
    where: { id: input.teamId, storeId: input.storeId },
    include: { scrim: { include: { teams: true, rooms: true } } },
  });
  if (!team) throw new NotFoundError("team", input.teamId, "ما لقيت طلب التسجيل.");
  if (team.status !== "PENDING_PROOF") {
    throw new ConflictError("not pending", "هالطلب مو بانتظار مراجعة.");
  }
  if (!input.accept) {
    const rejected = await db.scrimTeam.update({
      where: { id: team.id },
      data: { status: "REJECTED" },
    });
    return { accepted: false as const, team: rejected, next: "rejected" as const, scrim: team.scrim };
  }
  const fresh = await loadScrim(db, input.storeId, team.scrimId);
  if (fresh.status !== "OPEN" || !canTakeConfirmedSlot(fresh.teams, fresh.maxTeams)) {
    const waitlisted = await db.scrimTeam.update({
      where: { id: team.id },
      data: { status: "WAITLIST", waitlistSlot: nextWaitlistSlot(fresh.teams) },
    });
    return { accepted: true as const, team: waitlisted, next: "waitlist" as const, scrim: fresh };
  }
  const waiting = await db.scrimTeam.update({
    where: { id: team.id },
    data: { status: "WAITING_COMMIT" },
  });
  return { accepted: true as const, team: waiting, next: "commit" as const, scrim: fresh };
}

export async function acceptWaitlist(db: Db, input: { storeId: string; teamId: string }) {
  const team = await db.scrimTeam.findFirst({
    where: { id: input.teamId, storeId: input.storeId },
    include: { scrim: { include: { teams: true } } },
  });
  if (!team) throw new NotFoundError("team", input.teamId, "ما لقيت الفريق.");
  if (team.status !== "WAITLIST") throw new ConflictError("not waitlist", "هالفريق مو بالاحتياط.");
  const waitlisted = await db.scrimTeam.update({
    where: { id: team.id },
    data: { status: "WAITLIST" },
  });
  return waitlisted;
}

export async function commitTeam(
  db: Db,
  input: { storeId: string; leaderTelegramId: string; phrase: string; scrimId?: string },
) {
  const template = await ensureScrimTemplate(db, input.storeId);
  if (!isCommitPhrase(input.phrase, template.committedPhrase)) {
    throw new AppError("need commit", `اكتب «${template.committedPhrase}» للالتزام.`, "SCRIM_COMMIT");
  }
  const team = await db.scrimTeam.findFirst({
    where: {
      storeId: input.storeId,
      leaderTelegramId: input.leaderTelegramId,
      status: { in: ["WAITING_COMMIT", "WAITLIST"] },
      ...(input.scrimId ? { scrimId: input.scrimId } : {}),
    },
    include: { scrim: { include: { teams: true, rooms: true } } },
    orderBy: { createdAt: "desc" },
  });
  if (!team) throw new NotFoundError("team", input.leaderTelegramId, "ما عندك طلب بانتظار الالتزام.");
  const scrim = team.scrim;
  if (scrim.status === "DONE" || scrim.status === "CANCELED" || scrim.status === "DRAFT") {
    throw new ConflictError("locked", "التسجيل مقفل.");
  }
  if (team.status === "WAITLIST") {
    return { team, waitlisted: true as const, scrim, ack: "" };
  }
  if (!canTakeConfirmedSlot(scrim.teams, scrim.maxTeams)) {
    const waitlisted = await db.scrimTeam.update({
      where: { id: team.id },
      data: { status: "WAITLIST", waitlistSlot: nextWaitlistSlot(scrim.teams), committedAt: new Date() },
    });
    return { team: waitlisted, waitlisted: true as const, scrim, ack: "" };
  }
  const confirmed = await db.scrimTeam.update({
    where: { id: team.id },
    data: {
      status: "CONFIRMED",
      rosterSlot: nextRosterSlot(scrim.teams, (await ensureScrimTemplate(db, input.storeId)).rosterStartSlot ?? 1),
      committedAt: new Date(),
    },
  });
  const lock = await maybeLockIfFull(db, input.storeId, scrim.id);
  return {
    team: confirmed,
    waitlisted: false as const,
    scrim: lock.scrim,
    ack: renderCommitAck(template, lock.scrim.roomSecret),
    lock,
  };
}

export async function joinWaitlist(db: Db, input: { storeId: string; teamId: string; leaderTelegramId: string }) {
  const team = await db.scrimTeam.findFirst({
    where: { id: input.teamId, storeId: input.storeId, leaderTelegramId: input.leaderTelegramId },
    include: { scrim: { include: { teams: true } } },
  });
  if (!team) throw new NotFoundError("team", input.teamId, "ما لقيت الطلب.");
  if (team.status === "WAITLIST") return team;
  if (team.status === "CONFIRMED") throw new ConflictError("confirmed", "أنت مسجّل أصلًا.");
  return db.scrimTeam.update({
    where: { id: team.id },
    data: {
      status: "WAITLIST",
      waitlistSlot: nextWaitlistSlot(team.scrim.teams),
    },
  });
}

export async function withdrawTeam(
  db: Db,
  input: { storeId: string; scrimId: string; tagOrId: string },
) {
  const scrim = await loadScrim(db, input.storeId, input.scrimId);
  const tag = normalizeScrimTag(input.tagOrId);
  const team =
    scrim.teams.find((row) => row.id === input.tagOrId) ??
    scrim.teams.find((row) => row.tag === tag);
  if (!team) throw new NotFoundError("team", input.tagOrId, "ما لقيت هالفريق في اللستة.");
  await db.scrimTeam.update({
    where: { id: team.id },
    data: { status: "WITHDRAWN", rosterSlot: null },
  });
  const fresh = await loadScrim(db, input.storeId, scrim.id);
  const nextSlot = firstWaitlist(fresh.teams);
  const next = nextSlot ? fresh.teams.find((row) => row.id === nextSlot.id) : null;
  let promoted = null as null | { id: string; leaderTelegramId: string; tag: string };
  if (next && (fresh.status === "OPEN" || fresh.status === "LOCKED" || fresh.status === "LIVE")) {
    await db.scrimTeam.update({
      where: { id: next.id },
      data: { status: "WAITING_COMMIT", waitlistSlot: null },
    });
    promoted = { id: next.id, leaderTelegramId: next.leaderTelegramId, tag: next.tag };
  }
  const template = await ensureScrimTemplate(db, input.storeId);
  const after = await loadScrim(db, input.storeId, scrim.id);
  const rosterDraft = renderRosterCaption(template, after);
  await db.scrim.update({ where: { id: after.id }, data: { rosterDraft } });
  return { withdrawn: team, promoted, scrim: await loadScrim(db, input.storeId, scrim.id) };
}

export async function addTeamManual(
  db: Db,
  input: { storeId: string; scrimId: string; tag: string; leaderTelegramId?: string },
) {
  const scrim = await loadScrim(db, input.storeId, input.scrimId);
  if (scrim.status === "DONE" || scrim.status === "CANCELED") {
    throw new ConflictError("done", "هالسكرم منتهي.");
  }
  const tag = normalizeScrimTag(input.tag);
  if (!tag) throw new AppError("bad tag", "تاق غير صالح.", "SCRIM_TAG");
  if (duplicateTag(scrim.teams, tag)) throw new ConflictError("dup", "هالتاق مسجّل بهالسكرم.");
  if (!canTakeConfirmedSlot(scrim.teams, scrim.maxTeams)) {
    throw new ConflictError("full", "اللستة مكتملة.");
  }
  await db.scrimTeam.create({
    data: {
      scrimId: scrim.id,
      storeId: input.storeId,
      tag,
      leaderTelegramId: input.leaderTelegramId ?? "manual",
      status: "CONFIRMED",
      rosterSlot: nextRosterSlot(scrim.teams, (await ensureScrimTemplate(db, input.storeId)).rosterStartSlot ?? 1),
      committedAt: new Date(),
    },
  });
  const lock = await maybeLockIfFull(db, input.storeId, scrim.id);
  const template = await ensureScrimTemplate(db, input.storeId);
  const after = lock.scrim;
  const rosterDraft = renderRosterCaption(template, after);
  return db.scrim.update({
    where: { id: after.id },
    data: { rosterDraft },
    include: { teams: true, rooms: true },
  });
}

export async function setRoomCredentials(
  db: Db,
  input: { storeId: string; scrimId: string; roomIndex?: number; creds: RoomCredentials },
) {
  const scrim = await loadScrim(db, input.storeId, input.scrimId);
  const room =
    (input.roomIndex
      ? scrim.rooms.find((row) => row.index === input.roomIndex)
      : scrim.rooms.filter((row) => !row.publishedAt).sort((a, b) => a.index - b.index)[0]) ?? null;
  if (!room) throw new NotFoundError("room", input.scrimId, "ما فيه روم بانتظار الآيدي.");
  const updated = await db.scrimRoom.update({
    where: { id: room.id },
    data: {
      roomTelegramId: input.creds.roomId,
      roomPassword: input.creds.password,
    },
  });
  if (scrim.status === "LOCKED" || scrim.status === "OPEN") {
    await db.scrim.update({ where: { id: scrim.id }, data: { status: "LIVE" } });
  }
  return { room: updated, scrim: await loadScrim(db, input.storeId, scrim.id) };
}

export async function markRoomPublished(db: Db, storeId: string, roomId: string) {
  return db.scrimRoom.update({
    where: { id: roomId },
    data: { publishedAt: new Date() },
  });
}

export async function proposeRoomResult(
  db: Db,
  input: { storeId: string; roomId: string; photoFileId: string; parsed: ScrimRoomResult | null },
) {
  if (!input.parsed || input.parsed.rows.length === 0) {
    throw new AppError("unreadable", "ما قدرت أقرأ المراكز من الصورة. عدّل النتائج يدوي أو أرسل صورة أوضح.", "SCRIM_VISION");
  }
  const room = await db.scrimRoom.findFirst({
    where: { id: input.roomId, storeId: input.storeId },
  });
  if (!room) throw new NotFoundError("room", input.roomId, "ما لقيت الروم.");
  return db.scrimRoom.update({
    where: { id: room.id },
    data: {
      resultPhotoFileId: input.photoFileId,
      resultJson: input.parsed as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function confirmRoomResult(
  db: Db,
  input: { storeId: string; roomId: string; result?: ScrimRoomResult },
) {
  const room = await db.scrimRoom.findFirst({
    where: { id: input.roomId, storeId: input.storeId },
    include: { scrim: { include: { rooms: true, teams: true } } },
  });
  if (!room) throw new NotFoundError("room", input.roomId, "ما لقيت الروم.");
  const parsed = input.result ?? parseScrimRoomResult(room.resultJson);
  if (!parsed) {
    throw new AppError("no result", "أكد النتائج أول. ما ينشر رقم بدون تأكيد.", "SCRIM_CONFIRM");
  }
  const updated = await db.scrimRoom.update({
    where: { id: room.id },
    data: {
      resultJson: parsed as unknown as Prisma.InputJsonValue,
      confirmedAt: new Date(),
    },
  });
  return { room: updated, result: parsed, scrim: room.scrim };
}

export async function rankingForScrim(db: Db, storeId: string, scrimId: string) {
  const scrim = await loadScrim(db, storeId, scrimId);
  const template = await ensureScrimTemplate(db, storeId);
  const scoring = parseScoring(template.scoring);
  const results = scrim.rooms
    .filter((room) => room.confirmedAt && room.resultJson)
    .sort((a, b) => a.index - b.index)
    .map((room) => parseScrimRoomResult(room.resultJson))
    .filter((row): row is ScrimRoomResult => Boolean(row));
  return accumulateTeamScores(results, scoring);
}

export async function markTeamNoShow(db: Db, input: { storeId: string; scrimId: string; tag: string }) {
  const tag = normalizeScrimTag(input.tag);
  if (!tag) throw new AppError("bad tag", "تاق غير صالح.", "SCRIM_TAG");
  const scrim = await loadScrim(db, input.storeId, input.scrimId);
  const team = scrim.teams.find((row) => row.tag === tag);
  if (!team) throw new NotFoundError("team", tag, "ما لقيت هالفريق.");
  await db.scrimTeam.update({ where: { id: team.id }, data: { status: "NO_SHOW" } });
  await db.teamRecord.upsert({
    where: { storeId_tag: { storeId: input.storeId, tag } },
    create: {
      storeId: input.storeId,
      tag,
      attended: 0,
      absent: 1,
      participations: 1,
      trust: "ABSENT",
      lastScrimId: scrim.id,
    },
    update: {
      absent: { increment: 1 },
      participations: { increment: 1 },
      trust: "ABSENT",
      lastScrimId: scrim.id,
    },
  });
  return loadScrim(db, input.storeId, scrim.id);
}

export async function finalizeScrim(db: Db, storeId: string, scrimId: string) {
  const scrim = await loadScrim(db, storeId, scrimId);
  const template = await ensureScrimTemplate(db, storeId);
  const scores = await rankingForScrim(db, storeId, scrimId);
  const confirmed = scrim.teams.filter((team) => team.status === "CONFIRMED");
  for (const team of confirmed) {
    await db.teamRecord.upsert({
      where: { storeId_tag: { storeId, tag: team.tag } },
      create: {
        storeId,
        tag: team.tag,
        attended: 1,
        absent: 0,
        participations: 1,
        trust: "TRUSTED",
        lastScrimId: scrim.id,
      },
      update: {
        attended: { increment: 1 },
        participations: { increment: 1 },
        trust: "TRUSTED",
        lastScrimId: scrim.id,
      },
    });
  }
  await db.scrim.update({ where: { id: scrim.id }, data: { status: "DONE" } });
  return {
    rankingText: formatRanking(scores),
    thanks: template.thanksText,
    caption: renderFinalCaption(template, formatRanking(scores), scores[0]?.tag ?? ""),
    scores,
  };
}

export function confirmedLeaders(scrim: ScrimWithRelations): Array<{ telegramId: string; tag: string; slot: number | null }> {
  return scrim.teams
    .filter((team) => team.status === "CONFIRMED")
    .map((team) => ({ telegramId: team.leaderTelegramId, tag: team.tag, slot: team.rosterSlot }));
}

export function nextUnpublishedRoom(scrim: ScrimWithRelations) {
  return [...scrim.rooms].sort((a, b) => a.index - b.index).find((room) => !room.publishedAt) ?? null;
}

export function nextUnconfirmedRoom(scrim: ScrimWithRelations) {
  return [...scrim.rooms]
    .sort((a, b) => a.index - b.index)
    .find((room) => room.publishedAt && !room.confirmedAt) ?? null;
}

export function allRoomsConfirmed(scrim: ScrimWithRelations): boolean {
  return scrim.rooms.length > 0 && scrim.rooms.every((room) => Boolean(room.confirmedAt));
}

export async function getTeamById(db: Db, storeId: string, teamId: string) {
  return db.scrimTeam.findFirst({
    where: { id: teamId, storeId },
    include: { scrim: { include: { teams: true, rooms: true } } },
  });
}

export function previewOpenText(
  template: ScrimTemplateView,
  draft: {
    kind: ScrimKind;
    scheduledAtLabel: string;
    maxTeams: number;
    roomCount: number;
    rules: string;
    roomSecret: string;
  },
): string {
  const caption = renderOpenCaption(template, draft);
  return `${caption}\n\n— معاينة للمالك —\nالرقم السري (خاص للملتزمين فقط): ${draft.roomSecret || "غير محدد"}`;
}


/** Sets the per-room map order on the active scrim, adding rooms if there are more maps than rooms (max 8). */
export async function setActiveScrimMaps(db: Db, storeId: string, maps: string[]) {
  const scrim = await activeScrim(db, storeId);
  if (!scrim) throw new NotFoundError("scrim", storeId, "ما فيه سكرم جاري.");
  const list = maps.slice(0, 8);
  const have = scrim.rooms.length;
  if (list.length > have) {
    await db.scrimRoom.createMany({
      data: Array.from({ length: list.length - have }, (_, i) => ({ scrimId: scrim.id, storeId, index: have + i + 1 })),
    });
  }
  await db.scrim.update({
    where: { id: scrim.id },
    data: { maps: list, roomCount: Math.max(scrim.roomCount, list.length) },
  });
  return loadScrim(db, storeId, scrim.id);
}

/** Public channel version of the room message (no password). */
export function renderRoomIdPublicCaption(
  template: Pick<ScrimTemplateView, "roomIdText">,
  creds: RoomCredentials,
  room: { index?: number; maps?: readonly string[] } = {},
): string {
  return renderRoomIdCaption({ roomIdText: stripPasswordLines(template.roomIdText) }, { ...creds, password: "" }, room);
}

export async function scheduleRoomChannelPost(db: Db, roomId: string, at: Date | null) {
  return db.scrimRoom.update({
    where: { id: roomId },
    data: at ? { channelPostAt: at, channelPostedAt: null } : { channelPostAt: null, channelPostedAt: new Date() },
  });
}

export async function markRoomChannelPosted(db: Db, roomId: string) {
  return db.scrimRoom.update({ where: { id: roomId }, data: { channelPostedAt: new Date() } });
}
