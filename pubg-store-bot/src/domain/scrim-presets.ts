/** Ready-made template sets. Applied on demand with /scrim_preset; never automatically. */
export const MAD_UNIT_PRESET = {
  openCaptionGulf: `Mad Unit

register : now
ID : {الوقت}

Tag Here 👇`,
  openCaptionEurope: `Mad Unit

register : now
ID : {الوقت}

Tag Here 👇`,
  openDetailsText: `• فتح التسجيل سكرم {النوع}
🇸🇦🇰🇼🇴🇲🇧🇭🇶🇦🇦🇪
• توحيد 3
• تحديد نزلات {عدد_الفرق} تيم
• رومات ايسبورت
• الـ PC ممنوع`,
  defaultRules: `التصوير إجباري من التيم
• التوحيد 3 لجميع الأتيام ، التوحيد1 استبعاد
• في حال التيم أخذ الجائزة وتوحيده ناقص راح تروح الجائزة للمركز اللي بعده
أنتظار الرومات 5د ، {عدد_الرومات} رومات ‼️
{الخرائط}`,
  rosterTemplate: `Mad Unit SCRIMS

{اللستة}

Day {اليوم}
First id {الوقت}
TOP 1 IN RESULT GATE A 70 $ 🏆
Good Luck`,
  rosterLineFormat: "{n} ▸ {team}",
  rosterStartSlot: 5,
  roomIdChannelMode: "id_only",
  roomIdLeadMinutes: 7,
  rosterShowEmpty: false,
  roomIdText: `MadUnitScrims
{الخريطة} {رمز_الخريطة}
Id • {id}
Pass • {pass}
Start • 5m
same tag 3 or 0 points`,
  roomResultTemplate: `wwcd #{الأول}
with #{كيلات_الأول}kills

best player in the game
#{أكثر_كيلات}

gg for all 🤍`,
  thanksText: `• Excellent Work #{البطل}
• Gg #MadUnitEsport
gg all 🩷`,
  defaultMaps: ["Rondo", "Miramar", "Erangel", "Rondo"],
};

export const SCRIM_PRESETS: Record<string, typeof MAD_UNIT_PRESET> = {
  madunit: MAD_UNIT_PRESET,
};
