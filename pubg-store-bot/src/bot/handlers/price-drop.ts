import { detectInquiryCode } from "../../domain/inquiry-detect";
import { normalizeDigits } from "../../domain/digits";
import type { BotContext } from "../context";
import type { AppDeps } from "../deps";
import { isPrivateDirectPublishBot } from "./private-direct-publish";

const DROP =
  /(خفض|خفّض|خفضت|خفضته|خفضه|نزل|نزّل|نزلت|نزلته|نزله|نزلها|تخفيض|ارخصته|رخصته)/i;
const SET =
  /(عدل\s*السعر|عدّل\s*السعر|غير\s*السعر|غيّر\s*السعر|عدل\s*سعره|غير\s*سعره|خليه|خلّه|خله|خليها|السعر\s*صار|صار\s*السعر|السعر\s*الجديد|سعره\s*صار|حط\s*السعر|حط\s*سعر)/i;
const QUESTION = /[؟?]|بكم|كم\s*السعر|كم\s*آخر|كم\s*اخر|آخر\s*سعر|اخر\s*سعر/i;

export type PriceEdit = { price: number; kind: "drop" | "set" | "bare" };

export function parsePriceEdit(text: string): PriceEdit | null {
  const t = normalizeDigits(text ?? "").trim();
  if (!t || t.length > 80) return null;
  if (QUESTION.test(t)) return null;
  const bare = t.replace(/[,.،]/g, "").match(/^(\d{2,6})\s*(?:ريال|ر\.?س|sar)?$/i);
  if (bare) return { price: Number(bare[1]), kind: "bare" };
  const drop = DROP.test(t);
  const set = SET.test(t);
  if (!drop && !set) return null;
  if (/(اعلان|إعلان|حساب)/i.test(t) && !/(سعر|سعره|سعرها)/i.test(t)) return null;
  const nums = [...t.replace(/\b[A-Za-z]\d{1,5}\b/g, " ").matchAll(/(\d{2,6})/g)].map((m) => Number(m[1]));
  const price = nums.at(-1);
  if (!price || price < 10) return null;
  return { price, kind: drop && !set ? "drop" : "set" };
}

/** compat */
export function parsePriceDrop(text: string): number | null {
  const p = parsePriceEdit(text);
  return p && p.kind !== "bare" ? p.price : null;
}

export function priceDropCaption(price: number, ownerUsername?: string | null): string {
  void price;
  void ownerUsername;
  return "تم التخفيض 🔻";
}

const pendingKey = (storeId: string, uid: string) => `psb:priceedit:${storeId}:${uid}`;
const BARE_WINDOW_MS = 60 * 60 * 1000;

export async function tryPriceDrop(ctx: BotContext, deps: AppDeps): Promise<boolean> {
  if (!isPrivateDirectPublishBot(deps.botUsername)) return false;
  const msg = ctx.message;
  if (!msg || ctx.chat?.type !== "private" || !ctx.from) return false;
  if (msg.photo || msg.video) return false;
  const text = (msg.text ?? "").trim();
  const uid = String(ctx.from.id);
  const redis: any = (deps as any).redis;
  const db: any = deps.db;

  let edit = parsePriceEdit(text);
  const codeInText = detectInquiryCode(text);
  // «A010» لحاله بعد طلب تعديل معلّق
  if (!edit && codeInText && /^[A-Za-z]\d{1,5}$/.test(text) && redis) {
    const raw = await redis.get(pendingKey(deps.storeId, uid)).catch(() => null);
    if (raw) edit = JSON.parse(raw);
  }
  if (!edit) return false;

  const seller = await db.seller.findUnique({ where: { telegramId: uid } });
  if (!seller) return false;
  const store = await db.store.findUnique({
    where: { id: deps.storeId },
    select: { id: true, channelId: true, ownerUsername: true },
  });
  if (!store?.channelId) return false;

  const replied = (msg.reply_to_message as any)?.text ?? (msg.reply_to_message as any)?.caption ?? "";
  const repliedCode = replied ? detectInquiryCode(replied) : null;
  const code = codeInText ?? repliedCode;

  if (edit.kind === "bare" && !repliedCode) {
    // رقم لحاله: بس إذا ما فيه مسودة ولا استفسار منتظر، وإعلانه نزل قريب
    const draft = await deps.agent?.memory?.getDraft?.(deps.storeId, uid).catch(() => null);
    if (draft) return false;
    const waiting = await db.inquiry
      ?.findFirst?.({ where: { status: "WAITING_SELLER", listing: { seller: { telegramId: uid } } } })
      .catch(() => null);
    if (waiting) return false;
  }

  const active = await db.listing.findMany({
    where: { storeId: store.id, sellerId: seller.id, status: "PUBLISHED", channelMessageId: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  if (!active.length) return false;
  if (edit.kind === "bare" && !code) {
    const latest = active[0];
    if (Date.now() - new Date(latest.updatedAt ?? latest.createdAt).getTime() > BARE_WINDOW_MS) return false;
  }

  let target = code ? active.find((l: any) => String(l.shortCode).toUpperCase() === code.toUpperCase()) : undefined;
  if (code && !target) {
    await ctx.reply(`ما لقيت إعلان منشور لك برقم ${code}. إعلاناتك: ${active.map((l: any) => l.shortCode).join("، ")}`);
    return true;
  }
  if (!target) {
    if (active.length > 1 && edit.kind !== "bare") {
      if (redis) await redis.set(pendingKey(deps.storeId, uid), JSON.stringify(edit), "EX", 600).catch(() => undefined);
      await ctx.reply(`عندك أكثر من إعلان (${active.map((l: any) => l.shortCode).join("، ")}). أرسل رقم الإعلان اللي تبي أعدّل سعره، مثل ${active[0].shortCode}`);
      return true;
    }
    target = active[0];
  }
  if (redis) await redis.del(pendingKey(deps.storeId, uid)).catch(() => undefined);

  const oldPrice = Number(target.price ?? 0);
  const newPrice = edit.price;
  if ((deps as any).listings?.repriceListing) {
    await (deps as any).listings.repriceListing(target.id, newPrice);
  } else {
    await db.listing.update({ where: { id: target.id }, data: { price: newPrice } });
  }
  const isDrop = oldPrice > 0 && newPrice < oldPrice;
  if (isDrop) {
    await ctx.api.sendMessage(store.channelId, priceDropCaption(newPrice, store.ownerUsername), {
      reply_parameters: { message_id: Number(target.channelMessageId), allow_sending_without_reply: true },
    } as any);
  }
  deps.logger.info({ storeId: store.id, shortCode: target.shortCode, oldPrice, newPrice, isDrop }, "listing price edited");
  await ctx.reply(
    isDrop
      ? `تم التخفيض ونزلته بالقناة ✅ (${target.shortCode}: ${newPrice} ريال)`
      : `تم تعديل سعر ${target.shortCode} إلى ${newPrice} ريال في الإعلان ✅`,
  );
  return true;
}
