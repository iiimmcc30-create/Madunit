import type { PrismaClient } from "@prisma/client";
import { parseScrimRoomResult } from "../domain/scrim-parse";
import { accumulateTeamScores, formatRanking } from "../domain/scrim-score";
import { kindLabel, parseScoring } from "../domain/scrim-types";
import {
  ensureScrimTemplate,
  listStoreScrims,
  updateScrimTemplate,
} from "../services/scrim";
import { dash, escapeHtml } from "./html";
import { parseDropsLink, parseGroupChatId } from "../domain/scrim-group";
import { parseHhMm } from "../domain/scrim-time";
import { parseMapList } from "../domain/scrim-maps";

export async function scrimsIndexHtml(db: PrismaClient): Promise<string> {
  const rows = await listStoreScrims(db);
  const body = `<h1>السكرمات</h1>
  <table>
    <tr><th>المتجر</th><th>النوع</th><th>الوقت</th><th>الحالة</th><th>فرق</th><th>رومات</th><th></th></tr>
    ${
      rows.length
        ? rows
            .map((row) => {
              const confirmed = row.teams.filter((team) => team.status === "CONFIRMED").length;
              return `<tr>
      <td>${escapeHtml(row.store.title || row.store.botUsername)}</td>
      <td>${escapeHtml(kindLabel(row.kind))}</td>
      <td>${escapeHtml(row.scheduledAtLabel)}</td>
      <td>${escapeHtml(row.status)}</td>
      <td>${confirmed}/${row.maxTeams}</td>
      <td>${row.rooms.filter((room) => room.confirmedAt).length}/${row.roomCount}</td>
      <td><a href="${dash(`/scrims/${row.id}`)}">تفاصيل</a></td>
    </tr>`;
            })
            .join("")
        : `<tr><td colspan="7">ما فيه سكرمات بعد.</td></tr>`
    }
  </table>`;
  return body;
}

export async function scrimDetailHtml(db: PrismaClient, id: string): Promise<string | null> {
  const scrim = await db.scrim.findUnique({
    where: { id },
    include: { store: true, teams: true, rooms: true },
  });
  if (!scrim) return null;
  const template = await ensureScrimTemplate(db, scrim.storeId);
  const results = scrim.rooms
    .filter((room) => room.resultJson)
    .sort((a, b) => a.index - b.index)
    .map((room) => parseScrimRoomResult(room.resultJson))
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
  const ranking = formatRanking(accumulateTeamScores(results, parseScoring(template.scoring)));
  const teams = [...scrim.teams]
    .sort((a, b) => (a.rosterSlot ?? 99) - (b.rosterSlot ?? 99))
    .map(
      (team) =>
        `<tr><td>${team.rosterSlot ?? "—"}</td><td>${escapeHtml(team.tag)}</td><td>${escapeHtml(team.status)}</td><td><code>${escapeHtml(team.leaderTelegramId)}</code></td></tr>`,
    )
    .join("");
  const rooms = [...scrim.rooms]
    .sort((a, b) => a.index - b.index)
    .map((room) => {
      const parsed = parseScrimRoomResult(room.resultJson);
      return `<div class="card"><h3>روم ${room.index}</h3>
        <p>آيدي: ${room.publishedAt ? escapeHtml(room.roomTelegramId || "—") : "مخفي حتى النشر"}</p>
        <p>نتائج مؤكدة: ${room.confirmedAt ? "نعم" : "لا"}</p>
        <pre>${escapeHtml(parsed ? parsed.rows.map((row) => `${row.place}- ${row.tag} (${row.kills})`).join("\n") : "—")}</pre>
      </div>`;
    })
    .join("");
  return `<h1>سكرم ${escapeHtml(kindLabel(scrim.kind))}</h1>
  <p class="muted">${escapeHtml(scrim.store.title)} · ${escapeHtml(scrim.status)} · ${escapeHtml(scrim.scheduledAtLabel)}</p>
  <div class="card"><h2>الفرق</h2>
  <table><tr><th>#</th><th>التاق</th><th>الحالة</th><th>القائد</th></tr>${teams || `<tr><td colspan="4">لا فرق</td></tr>`}</table>
  </div>
  ${rooms}
  <div class="card"><h2>الترتيب التراكمي</h2><pre>${escapeHtml(ranking || "—")}</pre></div>
  <p><a href="${dash("/scrims")}">رجوع</a> · <a href="${dash("/scrim-templates")}">القوالب</a></p>`;
}

export async function scrimTemplatesHtml(db: PrismaClient): Promise<string> {
  const stores = await db.store.findMany({ orderBy: { createdAt: "desc" }, include: { scrimTemplate: true } });
  const cards = [];
  for (const store of stores) {
    const template = store.scrimTemplate ?? (await ensureScrimTemplate(db, store.id));
    cards.push(`<form class="card" method="post" action="${dash(`/scrim-templates/${store.id}`)}">
      <h2>${escapeHtml(store.title || store.botUsername)}</h2>
      <p>صورة الفتح: ${template.openPhotoFileId ? "محفوظة من البوت" : "ارفعها من /scrim_settings"}</p>
      <label>نص أوروبي</label><textarea name="openCaptionEurope" rows="5">${escapeHtml(template.openCaptionEurope)}</textarea>
      <label>نص خليجي</label><textarea name="openCaptionGulf" rows="5">${escapeHtml(template.openCaptionGulf)}</textarea>
      <label>رسالة التفاصيل بعد الإعلان (اختياري، تنرسل كرسالة ثانية)</label><textarea name="openDetailsText" rows="6">${escapeHtml(template.openDetailsText)}</textarea>
      <label>الشروط</label><textarea name="defaultRules" rows="4">${escapeHtml(template.defaultRules)}</textarea>
      <label>نص ملتزمين</label><textarea name="commitAckText" rows="3">${escapeHtml(template.commitAckText)}</textarea>
      <label>نص القفل</label><textarea name="lockText" rows="2">${escapeHtml(template.lockText)}</textarea>
      <label>قالب اللستة</label><textarea name="rosterTemplate" rows="4">${escapeHtml(template.rosterTemplate)}</textarea>
      <label>أول رقم باللستة (مثلاً 5 إذا 1-4 محجوزة)</label><input name="rosterStartSlot" type="number" min="1" max="50" value="${template.rosterStartSlot}"/>
      <label>شكل سطر اللستة ({n} الرقم، {team} الفريق)</label><input name="rosterLineFormat" value="${escapeHtml(template.rosterLineFormat)}"/>
      <p><label><input type="checkbox" name="rosterShowEmpty" value="1" ${template.rosterShowEmpty ? "checked" : ""}/> اعرض الخانات الفاضية باللستة</label></p>
      <label>الخرائط الافتراضية بالترتيب (مثل Rondo, Miramar, Erangel, Rondo)</label><input name="defaultMaps" value="${escapeHtml(template.defaultMaps.join(", "))}"/>
      <label>نص آيدي الروم</label><textarea name="roomIdText" rows="3">${escapeHtml(template.roomIdText)}</textarea>
      <label>قالب النتائج</label><textarea name="roomResultTemplate" rows="5">${escapeHtml(template.roomResultTemplate)}</textarea>
      <label>الشكر</label><textarea name="thanksText" rows="3">${escapeHtml(template.thanksText)}</textarea>
      <label>النقاط JSON</label><textarea name="scoring" rows="3">${escapeHtml(JSON.stringify(parseScoring(template.scoring)))}</textarea>
      <label>آيدي قروب المنظمين (أو أرسل /scrim_group داخل القروب)</label><input name="organizersGroupId" value="${escapeHtml(template.organizersGroupId ?? "")}" placeholder="-1001234567890"/>
      <label>رابط قروب تحديد النزلات</label><input name="dropsGroupLink" value="${escapeHtml(template.dropsGroupLink ?? "")}" placeholder="https://t.me/+xxxx"/>
      <label>آيدي قروب النزلات (أو أرسل /scrim_drops_group داخل القروب)</label><input name="dropsGroupId" value="${escapeHtml(template.dropsGroupId ?? "")}" placeholder="-1001234567890"/>
      <label>يفتح قروب النزلات قبل البداية بـ (دقيقة)</label><input name="dropsUnlockLeadMinutes" type="number" min="5" max="720" value="${template.dropsUnlockLeadMinutes}"/>
      <fieldset><legend>السكرم المجدول (يومي، بتوقيت السعودية)</legend>
        <p><label><input type="checkbox" name="scheduleEnabled" value="1" ${template.scheduleEnabled ? "checked" : ""}/> تفعيل</label></p>
        <label>الوقت</label><input name="scheduleTime" placeholder="22:00" value="${escapeHtml(template.scheduleTime ?? "")}"/>
        <label>النوع</label><select name="scheduleKind"><option value="GULF" ${template.scheduleKind !== "EUROPE" ? "selected" : ""}>خليجي</option><option value="EUROPE" ${template.scheduleKind === "EUROPE" ? "selected" : ""}>أوروبي</option></select>
        <label>عدد الفرق (2-25)</label><input name="scheduleMaxTeams" type="number" min="2" max="25" value="${template.scheduleMaxTeams}"/>
        <label>عدد الرومات</label><input name="scheduleRoomCount" type="number" min="1" max="8" value="${template.scheduleRoomCount}"/>
        <label>يفتح التسجيل قبل البداية بـ (دقيقة)</label><input name="scheduleOpenLeadMinutes" type="number" min="0" max="1440" value="${template.scheduleOpenLeadMinutes}"/>
      </fieldset>
      <p><label><input type="checkbox" name="postRoomPassToChannel" value="1" ${template.postRoomPassToChannel ? "checked" : ""}/> نشر آيدي وباس الروم بالقناة (بدونها يوصل بالخاص للفرق المؤكدة بس)</label></p>
      <p><label><input type="checkbox" name="autoApproveProof" value="1" ${template.autoApproveProof ? "checked" : ""}/> قبول صور التحقق تلقائيًا</label></p>
      <p><button>حفظ القوالب</button></p>
    </form>`);
  }
  return `<h1>قوالب السكرم</h1>${cards.join("") || "<p>ما فيه متاجر.</p>"}`;
}

export async function saveScrimTemplateForm(db: PrismaClient, storeId: string, form: Record<string, string>) {
  let scoring: unknown = undefined;
  if (form.scoring?.trim()) {
    scoring = parseScoring(JSON.parse(form.scoring));
  }
  await updateScrimTemplate(db, storeId, {
    openCaptionEurope: form.openCaptionEurope,
    openCaptionGulf: form.openCaptionGulf,
    defaultRules: form.defaultRules,
    commitAckText: form.commitAckText,
    lockText: form.lockText,
    rosterTemplate: form.rosterTemplate,
    roomIdText: form.roomIdText,
    roomResultTemplate: form.roomResultTemplate,
    thanksText: form.thanksText,
    autoApproveProof: form.autoApproveProof === "1",
    postRoomPassToChannel: form.postRoomPassToChannel === "1",
    ...scheduleFromForm(form),
    ...("organizersGroupId" in form ? { organizersGroupId: parseGroupChatId(form.organizersGroupId ?? "") } : {}),
    ...("dropsGroupLink" in form ? { dropsGroupLink: parseDropsLink(form.dropsGroupLink ?? "") } : {}),
    ...(scoring ? { scoring: scoring as object } : {}),
  });
}

function clampInt(raw: string | undefined, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

export function scheduleFromForm(form: Record<string, string>) {
  if (!("scheduleTime" in form)) return {};
  const hm = parseHhMm(form.scheduleTime ?? "");
  const time = hm ? `${String(hm.hour).padStart(2, "0")}:${String(hm.minute).padStart(2, "0")}` : null;
  return {
    dropsGroupId: parseGroupChatId(form.dropsGroupId ?? ""),
    dropsUnlockLeadMinutes: clampInt(form.dropsUnlockLeadMinutes, 5, 720, 90),
    scheduleEnabled: form.scheduleEnabled === "1" && Boolean(time),
    scheduleTime: time,
    scheduleKind: form.scheduleKind === "EUROPE" ? ("EUROPE" as const) : ("GULF" as const),
    scheduleMaxTeams: clampInt(form.scheduleMaxTeams, 2, 25, 16),
    scheduleRoomCount: clampInt(form.scheduleRoomCount, 1, 8, 1),
    rosterStartSlot: clampInt(form.rosterStartSlot, 1, 50, 1),
    rosterLineFormat: (form.rosterLineFormat ?? "").includes("{team}") ? form.rosterLineFormat : "{n}- {team}",
    rosterShowEmpty: form.rosterShowEmpty === "1",
    openDetailsText: form.openDetailsText ?? "",
    defaultMaps: parseMapList(form.defaultMaps ?? ""),
    scheduleOpenLeadMinutes: clampInt(form.scheduleOpenLeadMinutes, 0, 1440, 180),
  };
}
