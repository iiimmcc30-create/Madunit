import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export interface TelegramLoginPayload {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

export function verifyTelegramLogin(
  payload: TelegramLoginPayload,
  botToken: string,
  now = Date.now(),
): boolean {
  if (!payload.hash || !payload.id || !payload.auth_date) return false;
  if (Math.abs(now / 1000 - payload.auth_date) > 86400) return false;
  const dataCheck = Object.entries(payload)
    .filter(([key, value]) => key !== "hash" && value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("\n");
  const secret = createHash("sha256").update(botToken).digest();
  const hmac = createHmac("sha256", secret).update(dataCheck).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(hmac), Buffer.from(payload.hash));
  } catch {
    return false;
  }
}

export function signDashboardUser(telegramId: string, secret: string): string {
  const hmac = createHmac("sha256", secret).update(telegramId).digest("hex");
  return `${telegramId}.${hmac}`;
}

export function readDashboardUser(token: string | undefined, secret: string): string | null {
  if (!token) return null;
  const [telegramId, hmac] = token.split(".");
  if (!telegramId || !hmac) return null;
  const expected = createHmac("sha256", secret).update(telegramId).digest("hex");
  try {
    if (!timingSafeEqual(Buffer.from(hmac), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  return telegramId;
}

export function dashboardSecret(botToken: string, extra?: string): string {
  const token = extra?.trim() ?? "";
  return token.length > 0 ? token : createHash("sha256").update(`dash:${botToken}`).digest("hex");
}
