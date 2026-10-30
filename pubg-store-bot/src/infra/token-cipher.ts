import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "v1";

export function parseTokenEncryptionKey(raw: string, fallbackSeed = ""): Buffer {
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  if (trimmed) {
    const fromBase64 = Buffer.from(trimmed, "base64");
    if (fromBase64.length === 32) return fromBase64;
    if (Buffer.byteLength(trimmed, "utf8") === 32) return Buffer.from(trimmed, "utf8");
  }
  if (!fallbackSeed) {
    throw new Error("TOKEN_ENCRYPTION_KEY مطلوب (64 محرف hex).");
  }
  return createHash("sha256").update(`psb:token-key:${fallbackSeed}`).digest();
}

export function encryptSecret(plain: string, key: Buffer): string {
  if (key.length !== 32) throw new Error("encryption key must be 32 bytes");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptSecret(payload: string, key: Buffer): string {
  if (key.length !== 32) throw new Error("encryption key must be 32 bytes");
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new Error("invalid cipher payload");
  }
  const iv = Buffer.from(parts[1], "hex");
  const tag = Buffer.from(parts[2], "hex");
  const encrypted = Buffer.from(parts[3], "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function redactTelegramError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text
    .replace(/bot\d+:[A-Za-z0-9_-]+/gi, "bot<redacted>")
    .replace(/\d{8,}:[A-Za-z0-9_-]{20,}/g, "<redacted-token>");
}
