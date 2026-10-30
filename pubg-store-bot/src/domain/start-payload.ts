import { normalizeShortCode } from "./short-code";

export type StartPayload =
  | { kind: "store"; storeId: string }
  | { kind: "ask"; shortCode: string }
  | { kind: "scrim"; scrimId: string }
  | { kind: "none" };

const STORE_ID_RE = /^[A-Za-z0-9_-]{8,50}$/;

export function storeStartPayload(storeId: string): string {
  return `store_${storeId}`;
}

export function askStartPayload(shortCode: string): string {
  return `ask_${shortCode}`;
}

export function scrimStartPayload(scrimId: string): string {
  return `scrim_${scrimId}`;
}

export function parseStartPayload(raw: string | undefined | null): StartPayload {
  const text = (raw ?? "").trim();
  if (!text) return { kind: "none" };

  const ask = text.match(/^ask[_-]?(.+)$/i);
  if (ask) {
    const shortCode = normalizeShortCode(ask[1]);
    if (shortCode) return { kind: "ask", shortCode };
  }

  const scrim = text.match(/^scrim[_-](.+)$/i);
  if (scrim && STORE_ID_RE.test(scrim[1])) {
    return { kind: "scrim", scrimId: scrim[1] };
  }

  const store = text.match(/^store[_-](.+)$/i);
  if (store && STORE_ID_RE.test(store[1])) {
    return { kind: "store", storeId: store[1] };
  }

  return { kind: "none" };
}

export function botDeepLink(botUsername: string, payload: string): string {
  const user = botUsername.replace(/^@/, "").trim();
  return `https://t.me/${user}?start=${payload}`;
}
