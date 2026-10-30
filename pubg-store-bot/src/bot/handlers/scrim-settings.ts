import type { Bot } from "grammy";
import { isSuperAdmin } from "../../config";
import { AppError } from "../../domain/errors";
import { parseScoring } from "../../domain/scrim-types";
import { isClearWord, parseDropsLink, parseGroupChatId } from "../../domain/scrim-group";
import { parseMapList } from "../../domain/scrim-maps";
import { SCRIM_PRESETS } from "../../domain/scrim-presets";
import {
  addScrimModerator,
  ensureScrimTemplate,
  isScrimOperator,
  removeScrimModerator,
  setActiveScrimMaps,
  updateScrimTemplate,
} from "../../services/scrim";
import type { BotContext, ScrimSettingField } from "../context";
import type { AppDeps } from "../deps";
import { scrimSettingsKeyboard } from "../keyboards";
import { texts } from "../texts";

const PROMPTS: Record<ScrimSettingField, string> = {
  photo: "أرسل صورة إعلان فتح التسجيل. نحتفظ بـ file_id.",
  europe: "أرسل نص إعلان السكرم الأوروبي. المتغيرات: {النوع} {الوقت} {عدد_الفرق} {الشروط} {عدد_الرومات}",
  gulf: "أرسل نص إعلان السكرم الخليجي. نفس المتغيرات.",
  rules: "أرسل الشروط الافتراضية.",
  commit: "أرسل نص الالتزام بعد «ملتزمين». استخدم {السر} للرقم السري.",
  phrase: "أرسل عبارة الالتزام (الافتراضي: ملتزمين).",
  lock: "أرسل نص قفل التسجيل. {عدد_الفرق} متاح.",
  roster: "أرسل قالب اللستة. استخدم {اللستة} {النوع} {الوقت} {الشروط}.",
  room: "أرسل قالب آيدي الروم. استخدم {id} {pass}.",
  result: "أرسل قالب نتائج الروم. {رقم_الروم} {الأول} {أكثر_كيلات} {عدد_الكيلات} {الخمسة}.",
  thanks: "أرسل رسالة الشكر الختامية.",
  scoring: 'أرسل JSON النقاط مثل {"placement":{"1":10,"2":6,"3":5,"4":4,"5":3},"killPoints":1}',
  auto: "أرسل نعم لقبول صور التحقق تلقائي، أو لا للمراجعة اليدوية.",
  mod: "أرسل آيدي تلقرام للمشرف، أو remove 123456789.",
  group: "الأسهل: ضيف البوت مشرف بقروب المنظمين وأرسل /scrim_group داخل القروب.\nأو أرسل آيدي القروب هنا (يبدأ بـ -100)، أو off للإلغاء.",
  drops: "أرسل رابط قروب تحديد النزلات (مثل https://t.me/+xxxx)، أو off للإلغاء.",
  startslot: "أرسل أول رقم باللستة (مثلاً 5 إذا الخانات 1-4 محجوزة لكم).",
  linefmt: "أرسل شكل سطر اللستة. {n} الرقم و {team} الفريق. مثال: {n} ▸ {team}",
  details: "أرسل رسالة التفاصيل اللي تنرسل بعد إعلان الفتح (المتغيرات: {النوع} {الوقت} {عدد_الفرق} {عدد_الرومات} {الخرائط}). أو off للإلغاء.",
  maps: "أرسل الخرائط الافتراضية بالترتيب لكل روم، مثل: Rondo, Miramar, Erangel, Rondo",
  dropslead: "كم دقيقة قبل بداية السكرم يفتح قروب النزلات؟ (الافتراضي 90)\nقروب النزلات تربطه بإرسال /scrim_drops_group داخله.",
  pass: "وش ينزل بالقناة؟\n• «آيدي 7» = الآيدي بس (بدون باس) قبل البداية بـ 7 دقايق\n• «نعم» = الآيدي والباس\n• «لا» = تنبيه بس\nوالباس دايمًا يوصل للفرق المؤكدة بالخاص.\n(لا = يوصل للفرق المؤكدة بالخاص بس، والقناة تشوف تنبيه بدون الباس)",
};

function formatTemplateCard(template: Awaited<ReturnType<typeof ensureScrimTemplate>>): string {
  return `قوالب السكرم
صورة الفتح: ${template.openPhotoFileId ? "محفوظة" : "غير مرفوعة"}
قبول الصور تلقائي: ${template.autoApproveProof ? "نعم" : "لا"}
عبارة الالتزام: ${template.committedPhrase}
مشرفين: ${template.moderatorTelegramIds.join("، ") || "—"}
قروب المنظمين: ${template.organizersGroupId ?? "— (الطلبات توصلك بالخاص)"}
رابط النزلات: ${template.dropsGroupLink ?? "—"}
بالقناة: ${template.roomIdChannelMode === "id_only" ? `الآيدي بس قبل ${template.roomIdLeadMinutes} د` : template.postRoomPassToChannel ? "الآيدي والباس" : "تنبيه بس"} (الباس بالخاص للفرق)
قروب النزلات: ${template.dropsGroupId ?? "— (أرسل /scrim_drops_group داخله)"} · يفتح قبل ${template.dropsUnlockLeadMinutes} دقيقة
اللستة تبدأ من: ${template.rosterStartSlot} · السطر: ${template.rosterLineFormat}
الخرائط: ${template.defaultMaps.join(", ") || "—"}
الجدولة: ${template.scheduleEnabled && template.scheduleTime ? `كل يوم ${template.scheduleTime}` : "— (/scrim_schedule)"}
عدّل من الأزرار أو من لوحة الويب.`;
}

export function registerScrimSettingsHandlers(bot: Bot<BotContext>, deps: AppDeps) {
  bot.command("scrim_settings", async (ctx) => {
    const store = await deps.stores.getById(deps.storeId);
    const actor = String(ctx.from?.id ?? "");
    const template = await ensureScrimTemplate(deps.db, deps.storeId);
    if (!isScrimOperator(store.ownerTelegramId, actor, deps.config.superAdminTelegramId, template.moderatorTelegramIds) && !isSuperAdmin(deps.config, actor)) {
      await ctx.reply(texts.notOwner);
      return;
    }
    await ctx.reply(formatTemplateCard(template), { reply_markup: scrimSettingsKeyboard() });
  });

  bot.command("scrim_preset", async (ctx) => {
    const store = await deps.stores.getById(deps.storeId);
    const actor = String(ctx.from?.id ?? "");
    if (actor !== store.ownerTelegramId && !isSuperAdmin(deps.config, actor)) {
      await ctx.reply(texts.notOwner);
      return;
    }
    const name = (typeof ctx.match === "string" ? ctx.match : "").trim().toLowerCase();
    const preset = SCRIM_PRESETS[name];
    if (!preset) {
      await ctx.reply(`القوالب الجاهزة: ${Object.keys(SCRIM_PRESETS).join("، ")}\nمثال: /scrim_preset madunit`);
      return;
    }
    await updateScrimTemplate(deps.db, deps.storeId, preset);
    await ctx.reply("طبّقنا القالب ✅ تقدر تعدّل أي نص من /scrim_settings أو من لوحة الويب.");
  });

  bot.command("scrim_maps", async (ctx) => {
    const store = await deps.stores.getById(deps.storeId);
    const actor = String(ctx.from?.id ?? "");
    const template = await ensureScrimTemplate(deps.db, deps.storeId);
    if (!isScrimOperator(store.ownerTelegramId, actor, deps.config.superAdminTelegramId, template.moderatorTelegramIds)) {
      await ctx.reply(texts.notOwner);
      return;
    }
    const maps = parseMapList(typeof ctx.match === "string" ? ctx.match : "");
    if (!maps.length) {
      await ctx.reply("استخدم: /scrim_maps Rondo Miramar Erangel Rondo\n(تنطبق على السكرم الحالي، روم 1 ثم 2 ...)");
      return;
    }
    try {
      const updated = await setActiveScrimMaps(deps.db, deps.storeId, maps);
      await ctx.reply(`تم ✅ خرائط السكرم: ${updated.maps.map((m, i) => `${i + 1}) ${m}`).join(" · ")}`);
    } catch (error) {
      await ctx.reply(error instanceof AppError ? error.userMessage : "ما تم التعديل.");
    }
  });

  bot.callbackQuery(/^scset:/, async (ctx) => {
    const store = await deps.stores.getById(deps.storeId);
    const actor = String(ctx.from?.id ?? "");
    const template = await ensureScrimTemplate(deps.db, deps.storeId);
    if (!isScrimOperator(store.ownerTelegramId, actor, deps.config.superAdminTelegramId, template.moderatorTelegramIds)) {
      await ctx.answerCallbackQuery({ text: "للمالك فقط" });
      return;
    }
    const field = ctx.callbackQuery.data.slice("scset:".length) as ScrimSettingField;
    if (!PROMPTS[field]) {
      await ctx.answerCallbackQuery();
      return;
    }
    ctx.session.pendingScrimSetting = { field };
    await ctx.answerCallbackQuery();
    await ctx.reply(PROMPTS[field]);
  });

  bot.on("message:photo", async (ctx, next) => {
    if (ctx.session.pendingScrimSetting?.field !== "photo") {
      await next();
      return;
    }
    const photo = ctx.message.photo.at(-1);
    if (!photo) {
      await next();
      return;
    }
    ctx.session.pendingScrimSetting = undefined;
    await updateScrimTemplate(deps.db, deps.storeId, { openPhotoFileId: photo.file_id });
    await ctx.reply("حفظنا صورة إعلان الفتح.");
  });

  bot.on("message:text", async (ctx, next) => {
    const pending = ctx.session.pendingScrimSetting;
    if (!pending || pending.field === "photo") {
      await next();
      return;
    }
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) {
      await next();
      return;
    }
    ctx.session.pendingScrimSetting = undefined;
    try {
      if (pending.field === "europe") await updateScrimTemplate(deps.db, deps.storeId, { openCaptionEurope: text });
      if (pending.field === "gulf") await updateScrimTemplate(deps.db, deps.storeId, { openCaptionGulf: text });
      if (pending.field === "rules") await updateScrimTemplate(deps.db, deps.storeId, { defaultRules: text });
      if (pending.field === "commit") await updateScrimTemplate(deps.db, deps.storeId, { commitAckText: text });
      if (pending.field === "phrase") await updateScrimTemplate(deps.db, deps.storeId, { committedPhrase: text });
      if (pending.field === "lock") await updateScrimTemplate(deps.db, deps.storeId, { lockText: text });
      if (pending.field === "roster") await updateScrimTemplate(deps.db, deps.storeId, { rosterTemplate: text });
      if (pending.field === "room") await updateScrimTemplate(deps.db, deps.storeId, { roomIdText: text });
      if (pending.field === "result") await updateScrimTemplate(deps.db, deps.storeId, { roomResultTemplate: text });
      if (pending.field === "thanks") await updateScrimTemplate(deps.db, deps.storeId, { thanksText: text });
      if (pending.field === "scoring") {
        await updateScrimTemplate(deps.db, deps.storeId, {
          scoring: parseScoring(JSON.parse(text)) as object,
        });
      }
      if (pending.field === "auto") {
        await updateScrimTemplate(deps.db, deps.storeId, { autoApproveProof: /^(نعم|اي|إي|yes|1)/i.test(text) });
      }
      if (pending.field === "group") {
        if (isClearWord(text)) {
          await updateScrimTemplate(deps.db, deps.storeId, { organizersGroupId: null });
        } else {
          const groupId = parseGroupChatId(text);
          if (!groupId) {
            await ctx.reply("الآيدي لازم يبدأ بـ - مثل -1001234567890. أو أرسل /scrim_group داخل القروب.");
            return;
          }
          await updateScrimTemplate(deps.db, deps.storeId, { organizersGroupId: groupId });
        }
      }
      if (pending.field === "drops") {
        if (isClearWord(text)) {
          await updateScrimTemplate(deps.db, deps.storeId, { dropsGroupLink: null });
        } else {
          const link = parseDropsLink(text);
          if (!link) {
            await ctx.reply("الرابط مو واضح. أرسله كامل مثل https://t.me/+xxxx");
            return;
          }
          await updateScrimTemplate(deps.db, deps.storeId, { dropsGroupLink: link });
        }
      }
      if (pending.field === "dropslead") {
        const minutes = Number(text.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/\D/g, ""));
        if (!Number.isFinite(minutes) || minutes < 5 || minutes > 720) {
          await ctx.reply("أرسل رقم دقايق بين 5 و 720.");
          return;
        }
        await updateScrimTemplate(deps.db, deps.storeId, { dropsUnlockLeadMinutes: minutes });
      }
      if (pending.field === "startslot") {
        const n = Number(text.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/\D/g, ""));
        if (!Number.isInteger(n) || n < 1 || n > 50) {
          await ctx.reply("أرسل رقم من 1 إلى 50.");
          return;
        }
        await updateScrimTemplate(deps.db, deps.storeId, { rosterStartSlot: n });
      }
      if (pending.field === "linefmt") {
        if (!text.includes("{team}")) {
          await ctx.reply("لازم السطر يحتوي {team}. مثال: {n} ▸ {team}");
          return;
        }
        await updateScrimTemplate(deps.db, deps.storeId, { rosterLineFormat: text });
      }
      if (pending.field === "details") {
        await updateScrimTemplate(deps.db, deps.storeId, { openDetailsText: isClearWord(text) ? "" : text });
      }
      if (pending.field === "maps") {
        const maps = parseMapList(text);
        if (!maps.length) {
          await ctx.reply("ما عرفت الخرائط. اكتبها مثل: Rondo, Miramar, Erangel");
          return;
        }
        await updateScrimTemplate(deps.db, deps.storeId, { defaultMaps: maps });
      }
      if (pending.field === "pass") {
        if (/^(آيدي|ايدي|id)/i.test(text)) {
          const lead = Number(text.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/\D/g, "")) || 7;
          await updateScrimTemplate(deps.db, deps.storeId, { roomIdChannelMode: "id_only", roomIdLeadMinutes: Math.min(120, Math.max(0, lead)) });
        } else {
          const full = /^(نعم|اي|إي|yes|1)/i.test(text);
          await updateScrimTemplate(deps.db, deps.storeId, { postRoomPassToChannel: full, roomIdChannelMode: full ? "full" : "notice" });
        }
      }
      if (pending.field === "mod") {
        const remove = text.match(/remove\s+(\d{3,20})/i);
        if (remove) await removeScrimModerator(deps.db, deps.storeId, remove[1]);
        else await addScrimModerator(deps.db, deps.storeId, text.replace(/\D/g, ""));
      }
      await ctx.reply("حفظنا الإعداد.");
    } catch (error) {
      await ctx.reply(error instanceof AppError ? error.userMessage : "ما حفظنا الإعداد. تأكد من النص.");
    }
  });
}
