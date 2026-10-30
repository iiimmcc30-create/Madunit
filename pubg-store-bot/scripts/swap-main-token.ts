import "dotenv/config";
import { writeFileSync } from "node:fs";
import { loadConfig } from "../src/config";
import { createPrisma } from "../src/infra/prisma";
import { encryptSecret, decryptSecret } from "../src/infra/token-cipher";
const ID = "cmv6e3y8u0000tw3cvluu58it";
async function main() {
const config = loadConfig();
const db = createPrisma(config as any) as any;
const token = (process.env.BOT_TOKEN ?? "").trim();
const me = await (await fetch(`https://api.telegram.org/bot${token}/getMe`)).json();
if (!me.ok || me.result.username !== "madunitai_bot") throw new Error("getMe mismatch " + JSON.stringify(me));
const row = await db.store.findUnique({ where: { id: ID } });
const clash = await db.store.findFirst({ where: { botTelegramId: String(me.result.id), NOT: { id: ID } } });
if (clash) throw new Error("token already used by store " + clash.id);
const f = `backups/main-store-token-${new Date().toISOString().slice(0,10)}.json`;
writeFileSync(f, JSON.stringify({ id: ID, tokenCipher: row.tokenCipher, botUsername: row.botUsername, botTelegramId: row.botTelegramId, botFirstName: row.botFirstName, savedAt: new Date().toISOString() }, null, 2));
const cipher = encryptSecret(token, config.tokenEncryptionKey);
if (decryptSecret(cipher, config.tokenEncryptionKey) !== token) throw new Error("roundtrip");
await db.store.update({ where: { id: ID }, data: { tokenCipher: cipher, botUsername: me.result.username, botTelegramId: String(me.result.id), botFirstName: me.result.first_name } });
const wh = await (await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`)).json();
const after = await db.store.findUnique({ where: { id: ID } });
console.log(JSON.stringify({ backup: f, old: row.botUsername, new: after.botUsername, id: after.botTelegramId, scrim: after.scrimBotUsername, webhook: wh.result.url, pending: wh.result.pending_update_count }));
await db.$disconnect();
}
main().catch((e) => { console.error(String(e)); process.exit(1); });

