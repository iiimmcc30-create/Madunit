import { InlineKeyboard, Keyboard } from "grammy";
import type { ChatAdministratorRights } from "grammy/types";
import { SETUP_CHANNEL_REQUEST_ID, SETUP_GROUP_REQUEST_ID } from "../domain/channel";
import { askStartPayload, botDeepLink } from "../domain/start-payload";
import type { StoreView } from "../services/store";
import { texts } from "./texts";

export function inquiryUrlKeyboard(botUsername: string, shortCode: string) {
  return new InlineKeyboard().url(
    "استفسار",
    botDeepLink(botUsername, askStartPayload(shortCode)),
  );
}

export function startKeyboard() {
  return new InlineKeyboard()
    .text(texts.startYes, "start:list")
    .text(texts.startNo, "start:no");
}

export function ownerStartKeyboard() {
  return new InlineKeyboard()
    .text("الإحصائيات", "start:stats")
    .text("الإعدادات", "start:settings");
}

export function previewKeyboard() {
  return new InlineKeyboard()
    .text("نشر", "preview:publish")
    .text("تعديل", "preview:edit")
    .text("إلغاء", "preview:cancel");
}

export function editKeyboard() {
  return new InlineKeyboard()
    .text("الفيديو", "edit:video")
    .text("الوصف", "edit:desc")
    .row()
    .text("السعر", "edit:price")
    .text("الربط", "edit:bind")
    .row()
    .text("رجوع للمعاينة", "edit:back");
}

export function storePickerKeyboard(stores: StoreView[], prefix = "store:pick") {
  const keyboard = new InlineKeyboard();
  stores.forEach((store, index) => {
    keyboard.text(store.title || store.ownerUsername, `${prefix}:${store.id}`);
    if (index % 2 === 1) keyboard.row();
  });
  return keyboard;
}

export function settingsKeyboard(storeId: string) {
  return new InlineKeyboard()
    .text("الرسوم", `st:fee:${storeId}`)
    .text("اليوزر", `st:user:${storeId}`)
    .row()
    .text("الاسم", `st:title:${storeId}`)
    .text("المعجم", `st:gloss:${storeId}`)
    .row()
    .text("تعليمات التحويل", `st:ins:${storeId}`)
    .row()
    .text("نشر فوري", `st:mode:${storeId}:AUTO`)
    .text("بموافقة", `st:mode:${storeId}:APPROVAL`)
    .row()
    .text("تجديد الاشتراك", `st:renew:${storeId}`)
    .row()
    .text("اربط/غيّر القناة", `st:bind:${storeId}`)
    .text("فك الربط", `st:unbind:${storeId}`);
}

export function adminStoreKeyboard(storeId: string) {
  return new InlineKeyboard()
    .text("تفعيل", `ad:on:${storeId}`)
    .text("إيقاف", `ad:off:${storeId}`)
    .row()
    .text("تعيين أيام التفعيل", `ad:ext:${storeId}`)
    .text("حذف البوت", `ad:del:${storeId}`)
    .row()
    .text("فك ربط القناة/المجموعة", `ad:unb:${storeId}`)
    .text("ربط بوت سكرمات", `ad:scrim:${storeId}`);
}

export function adminConfirmKeyboard(action: string, storeId: string) {
  return new InlineKeyboard()
    .text("✅ أكّد", `ad:${action}ok:${storeId}`)
    .text("إلغاء", "ad:nop");
}

export function platformMenuKeyboard() {
  return new InlineKeyboard()
    .text("📋 المتاجر", "pm:stores")
    .text("🟢 حالة البوتات", "pm:status")
    .row()
    .text("➕ إضافة بوت بتوكن", "ad:add")
    .text("🧾 إيصالات الاشتراك", "ad:pays")
    .row()
    .text("📊 الإحصائيات", "pm:stats")
    .text("❓ المساعدة", "pm:help");
}

export function adminHomeKeyboard() {
  return new InlineKeyboard()
    .text("إضافة متجر بتوكن", "ad:add")
    .text("إيصالات الاشتراك", "ad:pays")
    .row()
    .text("حالة البوتات", "pm:status")
    .text("الإحصائيات", "pm:stats");
}

function channelPostAdminRights(): ChatAdministratorRights {
  return {
    is_anonymous: false,
    can_manage_chat: true,
    can_delete_messages: true,
    can_manage_video_chats: false,
    can_restrict_members: false,
    can_promote_members: false,
    can_change_info: false,
    can_invite_users: false,
    can_post_stories: false,
    can_edit_stories: false,
    can_delete_stories: false,
    can_send_welcome_messages: false,
    can_post_messages: true,
    can_edit_messages: true,
  };
}

function groupPostAdminRights(): ChatAdministratorRights {
  return {
    is_anonymous: false,
    can_manage_chat: true,
    can_delete_messages: true,
    can_manage_video_chats: false,
    can_restrict_members: false,
    can_promote_members: false,
    can_change_info: false,
    can_invite_users: false,
    can_post_stories: false,
    can_edit_stories: false,
    can_delete_stories: false,
    can_send_welcome_messages: false,
    can_pin_messages: true,
  };
}

export function setupChannelKeyboard() {
  return new Keyboard()
    .requestChat("👥 اختيار مجموعة", SETUP_GROUP_REQUEST_ID, {
      chat_is_channel: false,
      bot_is_member: true,
      request_title: true,
      request_username: true,
      user_administrator_rights: groupPostAdminRights(),
      bot_administrator_rights: groupPostAdminRights(),
    })
    .requestChat("📢 اختيار قناة", SETUP_CHANNEL_REQUEST_ID, {
      chat_is_channel: true,
      bot_is_member: true,
      request_title: true,
      request_username: true,
      user_administrator_rights: channelPostAdminRights(),
      bot_administrator_rights: channelPostAdminRights(),
    })
    .resized()
    .oneTime()
    .placeholder("أو أرسل @يوزر القناة/المجموعة أو رابط أو حوّل رسالة");
}

export function removeReplyKeyboard() {
  return { remove_keyboard: true as const };
}

export function agentConfirmKeyboard() {
  return new InlineKeyboard().text("تأكيد", "ag:ok").text("إلغاء", "ag:no");
}

export function scrimRegisterKeyboard(botUsername: string, scrimId: string) {
  return new InlineKeyboard().url("سجّل فريقك", botDeepLink(botUsername, `scrim_${scrimId}`));
}

export function scrimOpenPreviewKeyboard(scrimId: string) {
  return new InlineKeyboard()
    .text("نشر في القناة", `sc:open:${scrimId}`)
    .text("إلغاء", `sc:nop:${scrimId}`);
}

export function scrimProofKeyboard(teamId: string) {
  return new InlineKeyboard()
    .text("قبول", `sc:ok:${teamId}`)
    .text("رفض", `sc:no:${teamId}`);
}

export function scrimWaitlistKeyboard(teamId: string) {
  return new InlineKeyboard().text("أدخل الاحتياط", `sc:wl:${teamId}`);
}

export function scrimRosterKeyboard(scrimId: string) {
  return new InlineKeyboard()
    .text("نشر اللستة", `sc:rpub:${scrimId}`)
    .text("تعديل", `sc:redit:${scrimId}`);
}

export function scrimResultKeyboard(roomId: string) {
  return new InlineKeyboard()
    .text("تأكيد ونشر", `sc:rok:${roomId}`)
    .text("تعديل", `sc:rno:${roomId}`);
}

export function scrimSettingsKeyboard() {
  return new InlineKeyboard()
    .text("صورة الفتح", "scset:photo")
    .text("نص أوروبي", "scset:europe")
    .row()
    .text("نص خليجي", "scset:gulf")
    .text("الشروط", "scset:rules")
    .row()
    .text("نص ملتزمين", "scset:commit")
    .text("عبارة الالتزام", "scset:phrase")
    .row()
    .text("نص القفل", "scset:lock")
    .text("قالب اللستة", "scset:roster")
    .row()
    .text("نص آيدي الروم", "scset:room")
    .text("قالب النتائج", "scset:result")
    .row()
    .text("رسالة الشكر", "scset:thanks")
    .text("النقاط", "scset:scoring")
    .row()
    .text("قبول الصور تلقائي", "scset:auto")
    .text("مشرف", "scset:mod")
    .row()
    .text("قروب المنظمين", "scset:group")
    .text("رابط النزلات", "scset:drops")
    .row()
    .text("الآيدي بالقناة", "scset:pass")
    .text("وقت فتح النزلات", "scset:dropslead")
    .row()
    .text("أول رقم باللستة", "scset:startslot")
    .text("شكل سطر اللستة", "scset:linefmt")
    .row()
    .text("رسالة التفاصيل", "scset:details")
    .text("الخرائط", "scset:maps");
}

export function subscriptionReviewKeyboard(paymentId: string) {
  return new InlineKeyboard()
    .text("تأكيد 30 يوم", `subpay:ok:${paymentId}`)
    .text("رفض", `subpay:no:${paymentId}`);
}
