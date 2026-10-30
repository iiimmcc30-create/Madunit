import { parseMapList } from "./scrim-maps";
import { normalizeScrimTag } from "./scrim-tag";
import {
  parseMaxTeams,
  parseRoomCount,
  type RoomCredentials,
  type ScrimKind,
  type ScrimOpenExtract,
  type ScrimRoomResult,
  type ScrimStandingRow,
  type ScrimTopKiller,
} from "./scrim-types";

export function looksLikeOpenScrim(text: string): boolean {
  const t = text.trim();
  return /افتح\s*سكرم/.test(t) || /سكرم\s*(خليجي|أوروبي|اوروبي|يورو)/.test(t);
}

export function looksLikeJoinScrim(text: string): boolean {
  const t = text.trim();
  return (
    /^(بسجل|سجلني|أسجل|اسجل)$/.test(t) ||
    /(أبي|ابي|أبغى|ابغى|أريد|ابغ)\s*(أشارك|اشارك|أدخل|ادخل|أسجل|اسجل)/.test(t) ||
    /في\s*مكان/.test(t) ||
    /مكان\s*\??$/.test(t) ||
    /أشارك|اشارك/.test(t) ||
    /تسجيل\s*(فريق|سكرم)/.test(t)
  );
}

export function looksLikeRoomCredentials(text: string): boolean {
  const t = text.trim();
  return /(آيدي|ايدي|آي دي|id).{0,24}(روم|room)/i.test(t) || /(باسورد|باس|password).{0,24}(روم|room)/i.test(t);
}

export function looksLikeResultPhotoCaption(text: string): boolean {
  return /نتائج|ترتيب|روم\s*\d|centers|kill/i.test(text);
}

function extractKind(text: string): ScrimKind | null {
  if (/خليجي|gulf/i.test(text)) return "GULF";
  if (/أوروبي|اوروبي|يورو|europe/i.test(text)) return "EUROPE";
  return null;
}

function extractTimeLabel(text: string): string | null {
  const match =
    text.match(/الساعة\s+([^\n]+?)(?=\s+(?:\d{2}\s*(?:تيم|فريق)|(?:\d+)\s*روم)|$)/) ||
    text.match(/(الليلة|بكرة|غداً|غدا|اليوم)\s+([^\n]{0,40})/);
  if (match) {
    const label = match[0].trim().replace(/\s+/g, " ");
    return label.length >= 3 ? label : null;
  }
  const clock = text.match(/(\d{1,2}(?::\d{2})?\s*(?:الليلة|مساء|صباح|م|ص)?)/);
  return clock ? clock[1].trim() : null;
}

function extractSecret(text: string): string | null {
  const match = text.match(/(?:الرقم\s*السري|سري|باسورد|باس|password|سر)\s*[:：]?\s*([A-Za-z0-9_\-]{3,20})/i);
  return match ? match[1] : null;
}

export function heuristicExtractScrimOpen(text: string): ScrimOpenExtract {
  const maxDirect = text.match(/(\d{1,2})\s*(?:تيم|فريق|team)/i) ?? text.match(/\b(16|18)\b/);
  const maps = parseMapList(text);
  const rooms = text.match(/(\d+)\s*روم/);
  return {
    kind: extractKind(text),
    timeLabel: extractTimeLabel(text),
    maxTeams: parseMaxTeams(maxDirect?.[1] ?? null),
    roomCount: parseRoomCount(rooms?.[1] ?? null) ?? (maps.length ? parseRoomCount(maps.length) : null),
    roomSecret: extractSecret(text),
    rules: null,
    ...(maps.length ? { maps } : {}),
  };
}

export function mergeScrimOpenExtract(
  heuristic: ScrimOpenExtract,
  llm: Partial<ScrimOpenExtract> | null,
): ScrimOpenExtract {
  if (!llm) return heuristic;
  return {
    kind: heuristic.kind ?? llm.kind ?? null,
    timeLabel: heuristic.timeLabel ?? llm.timeLabel ?? null,
    maxTeams: heuristic.maxTeams ?? llm.maxTeams ?? null,
    roomCount: heuristic.roomCount ?? llm.roomCount ?? null,
    roomSecret: heuristic.roomSecret ?? llm.roomSecret ?? null,
    rules: heuristic.rules ?? llm.rules ?? null,
    ...(heuristic.maps?.length ? { maps: heuristic.maps } : llm.maps?.length ? { maps: llm.maps } : {}),
  };
}

export function heuristicExtractRoomCredentials(text: string): RoomCredentials | null {
  const idMatch =
    text.match(/(?:آيدي|ايدي|آي دي|id)\s*(?:الروم|روم|room)?\s*[:：]?\s*([A-Za-z0-9_\-]{3,32})/i) ||
    text.match(/room\s*(?:id)?\s*[:：]?\s*([A-Za-z0-9_\-]{3,32})/i);
  const passMatch =
    text.match(/(?:الباسورد|باسورد|باس|password|pass)\s*[:：]?\s*([A-Za-z0-9_\-]{3,32})/i);
  if (!idMatch || !passMatch) return null;
  return { roomId: idMatch[1], password: passMatch[1] };
}

function asFiniteInt(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

export function parseScrimRoomResult(raw: unknown): ScrimRoomResult | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const list = Array.isArray(obj.rows) ? obj.rows : Array.isArray(obj.standings) ? obj.standings : [];
  const rows: ScrimStandingRow[] = [];
  const seenPlaces = new Set<number>();
  const seenTags = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const place = asFiniteInt(row.place ?? row.rank ?? row.position);
    const kills = asFiniteInt(row.kills ?? row.kill);
    const tag = normalizeScrimTag(String(row.tag ?? row.team ?? row.name ?? ""));
    if (place === null || place < 1 || place > 5) continue;
    if (kills === null) continue;
    if (!tag) continue;
    if (seenPlaces.has(place) || seenTags.has(tag)) continue;
    seenPlaces.add(place);
    seenTags.add(tag);
    rows.push({ place, tag, kills });
  }
  rows.sort((a, b) => a.place - b.place);
  if (rows.length === 0) return null;

  let topKiller: ScrimTopKiller | null = null;
  const killerRaw = obj.topKiller;
  if (killerRaw && typeof killerRaw === "object") {
    const killer = killerRaw as Record<string, unknown>;
    const kills = asFiniteInt(killer.kills);
    const name = String(killer.name ?? "").trim();
    const tag = normalizeScrimTag(String(killer.tag ?? killer.team ?? "")) ?? rows[0]?.tag ?? "";
    if (kills !== null && name && tag) {
      topKiller = { name, tag, kills };
    }
  }
  if (!topKiller) {
    const best = [...rows].sort((a, b) => b.kills - a.kills || a.place - b.place)[0];
    if (best) topKiller = { name: best.tag, tag: best.tag, kills: best.kills };
  }
  return { rows, topKiller };
}

export function formatStandingsLines(result: ScrimRoomResult): string {
  return result.rows.map((row) => `${row.place}- ${row.tag}  (${row.kills} كيل)`).join("\n");
}
