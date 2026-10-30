/**
 * Per-bot gate: private MAD AI / agent replies off for listed bots.
 * Traders→channel mirror and slash commands are unaffected.
 * Re-enable: remove the username from PRIVATE_AGENT_DISABLED_BOTS.
 */
export const PRIVATE_AGENT_DISABLED_BOTS = ["dmstor_bot", "sultan_sl_bot", "s3dstore_bot"] as const;

export function isPrivateAgentDisabled(botUsername: string | null | undefined): boolean {
  const u = (botUsername ?? "").replace(/^@/, "").toLowerCase();
  return (PRIVATE_AGENT_DISABLED_BOTS as readonly string[]).includes(u as never);
}

/** DMSTOR store bot only (not sarhstoree / madunit / others). */
export function isDmstorBot(botUsername: string | null | undefined): boolean {
  const u = (botUsername ?? "").replace(/^@/, "").toLowerCase();
  return u === "dmstor_bot";
}
