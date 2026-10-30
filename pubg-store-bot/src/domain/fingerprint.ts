import { createHash } from "node:crypto";
import type { ExtractedFields } from "./extract";

export function fingerprintFromVideo(videoUniqueId?: string | null): string | null {
  if (!videoUniqueId) return null;
  return `video:${videoUniqueId}`;
}

export function normalizePlayerId(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 5 ? digits : null;
}

export function fingerprintFromPlayerId(playerId?: string | null): string | null {
  const id = normalizePlayerId(playerId);
  return id ? `player:${id}` : null;
}

export function fingerprintFromFields(fields: ExtractedFields): string | null {
  const binding = (fields.binding ?? "").trim().toLowerCase();
  const skins = [...(fields.skins ?? [])].map((item) => item.trim()).filter(Boolean).sort().join(",");
  const weapons = [...(fields.upgradedWeapons ?? [])]
    .map((item) => item.trim())
    .filter(Boolean)
    .sort()
    .join(",");
  const country = (fields.country ?? "").trim().toLowerCase();
  if (!fields.level && !binding && !skins && !weapons && !country) return null;
  const raw = `${fields.level ?? ""}|${binding}|${skins}|${weapons}|${country}`;
  const hash = createHash("sha256").update(raw).digest("hex").slice(0, 16);
  return `fields:${hash}`;
}

export function collectFingerprints(input: {
  videoUniqueId?: string | null;
  fields?: ExtractedFields | null;
}): string[] {
  const fields = input.fields ?? {};
  const keys = [
    fingerprintFromPlayerId(fields.playerId),
    fingerprintFromVideo(input.videoUniqueId),
    fingerprintFromFields(fields),
  ].filter((key): key is string => Boolean(key));
  return [...new Set(keys)];
}

export function primaryFingerprint(keys: string[]): string | null {
  return keys.find((key) => key.startsWith("player:"))
    ?? keys.find((key) => key.startsWith("video:"))
    ?? keys[0]
    ?? null;
}

export function strongFingerprints(keys: string[]): string[] {
  return keys.filter((key) => key.startsWith("player:") || key.startsWith("video:"));
}
