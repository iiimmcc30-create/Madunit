import type { IncomingMessage, ServerResponse } from "node:http";
import type { StoreView } from "../services/store";

export interface BotController {
  addFromToken(token: string, actorTelegramId: string): Promise<StoreView>;
  startStore(storeId: string): Promise<void>;
  stopStore(storeId: string): Promise<void>;
  setEnabled(storeId: string, enabled: boolean, actorTelegramId: string): Promise<StoreView>;
  extend(storeId: string, days: number, actorTelegramId: string): Promise<StoreView>;
  remove(storeId: string, actorTelegramId: string): Promise<StoreView>;
  handleWebhook(botId: string, req: IncomingMessage, res: ServerResponse): Promise<boolean>;
  sendStoreMessage(storeId: string, telegramId: string, text: string): Promise<void>;
  botUsernameFor(storeId: string): string | undefined;
  /** Attaches a dedicated scrims bot to the store and restarts its bots. Returns the bot username. */
  attachScrimBot(storeId: string, token: string, actorTelegramId: string): Promise<string>;
  detachScrimBot(storeId: string, actorTelegramId: string): Promise<void>;
}
