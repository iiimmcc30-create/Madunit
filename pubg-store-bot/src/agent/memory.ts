import type Redis from "ioredis";
import type { AgentListingDraft, AgentMedia, PendingAgentConfirm } from "./tools";

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

const MAX_TURNS = 20;

function chatKey(storeId: string, telegramId: string) {
  return `psb:chat:${storeId}:${telegramId}`;
}

function focusKey(storeId: string, telegramId: string) {
  return `psb:chat:focus:${storeId}:${telegramId}`;
}

function draftKey(storeId: string, telegramId: string) {
  return `psb:agent:draft:${storeId}:${telegramId}`;
}

function confirmKey(storeId: string, telegramId: string) {
  return `psb:agent:confirm:${storeId}:${telegramId}`;
}

function searchKey(storeId: string, telegramId: string) {
  return `psb:agent:search:${storeId}:${telegramId}`;
}

function pendingMediaKey(storeId: string, telegramId: string) {
  return `psb:agent:media:${storeId}:${telegramId}`;
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function createChatMemory(redis: Redis) {
  return {
    async history(storeId: string, telegramId: string): Promise<ChatTurn[]> {
      const raw = await redis.lrange(chatKey(storeId, telegramId), -MAX_TURNS, -1);
      return raw
        .map((item) => parseJson<ChatTurn>(item))
        .filter((item): item is ChatTurn => Boolean(item?.role && item.text));
    },
    async append(storeId: string, telegramId: string, turn: ChatTurn): Promise<void> {
      const key = chatKey(storeId, telegramId);
      const lastRaw = await redis.lindex(key, -1);
      const last = parseJson<ChatTurn>(lastRaw);
      if (last?.role === turn.role && last.text === turn.text) return;
      await redis.rpush(key, JSON.stringify(turn));
      await redis.ltrim(key, -MAX_TURNS, -1);
      await redis.expire(key, 60 * 60 * 24 * 7);
    },
    async reset(storeId: string, telegramId: string): Promise<void> {
      await redis.del(
        chatKey(storeId, telegramId),
        focusKey(storeId, telegramId),
        draftKey(storeId, telegramId),
        confirmKey(storeId, telegramId),
        searchKey(storeId, telegramId),
        pendingMediaKey(storeId, telegramId),
      );
    },
    async setFocus(storeId: string, telegramId: string, shortCode: string): Promise<void> {
      await redis.set(focusKey(storeId, telegramId), shortCode, "EX", 60 * 60 * 24 * 7);
    },
    async getFocus(storeId: string, telegramId: string): Promise<string | null> {
      return redis.get(focusKey(storeId, telegramId));
    },
    async getDraft(storeId: string, telegramId: string): Promise<AgentListingDraft | null> {
      return parseJson<AgentListingDraft>(await redis.get(draftKey(storeId, telegramId)));
    },
    async setDraft(storeId: string, telegramId: string, draft: AgentListingDraft): Promise<void> {
      await redis.set(draftKey(storeId, telegramId), JSON.stringify(draft), "EX", 60 * 60 * 24);
    },
    async clearDraft(storeId: string, telegramId: string): Promise<void> {
      await redis.del(draftKey(storeId, telegramId));
    },
    async setConfirm(storeId: string, telegramId: string, pending: PendingAgentConfirm): Promise<void> {
      await redis.set(confirmKey(storeId, telegramId), JSON.stringify(pending), "EX", 60 * 10);
    },
    async takeConfirm(storeId: string, telegramId: string): Promise<PendingAgentConfirm | null> {
      const key = confirmKey(storeId, telegramId);
      const raw = await redis.get(key);
      await redis.del(key);
      return parseJson<PendingAgentConfirm>(raw);
    },
    async setLastSearch(storeId: string, telegramId: string, codes: string[]): Promise<void> {
      await redis.set(searchKey(storeId, telegramId), JSON.stringify(codes), "EX", 60 * 60 * 24);
    },
    async getLastSearch(storeId: string, telegramId: string): Promise<string[]> {
      return parseJson<string[]>(await redis.get(searchKey(storeId, telegramId))) ?? [];
    },
    async setPendingMedia(storeId: string, telegramId: string, media: AgentMedia): Promise<void> {
      if (!media.photoFileId && !media.videoFileId) return;
      const slim: AgentMedia = {
        photoFileId: media.photoFileId,
        videoFileId: media.videoFileId,
        videoUniqueId: media.videoUniqueId,
      };
      await redis.set(pendingMediaKey(storeId, telegramId), JSON.stringify(slim), "EX", 60 * 60 * 6);
    },
    async takePendingMedia(storeId: string, telegramId: string): Promise<AgentMedia | null> {
      const key = pendingMediaKey(storeId, telegramId);
      const raw = await redis.get(key);
      // نبقيها للقراءة المتكررة إلى أن تُربط بمسودة
      return parseJson<AgentMedia>(raw);
    },
    async clearPendingMedia(storeId: string, telegramId: string): Promise<void> {
      await redis.del(pendingMediaKey(storeId, telegramId));
    },
  };
}

export type ChatMemory = ReturnType<typeof createChatMemory>;
export { MAX_TURNS };
