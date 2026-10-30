/** PUBG Mobile maps used in scrims, in canonical English spelling. */
export const SCRIM_MAPS: ReadonlyArray<{ name: string; emoji: string; aliases: RegExp }> = [
  { name: "Erangel", emoji: "🌲", aliases: /^(erangel|eranqel|ارانقل|إرانغل|ارانغل|ايرانقل|إرانجل|ارانجل)$/i },
  { name: "Miramar", emoji: "🏜", aliases: /^(miramar|ميرامار|ميرمار)$/i },
  { name: "Rondo", emoji: "🏔", aliases: /^(rondo|روندو)$/i },
  { name: "Sanhok", emoji: "🌴", aliases: /^(sanhok|سانهوك)$/i },
  { name: "Vikendi", emoji: "❄️", aliases: /^(vikendi|فيكندي)$/i },
  { name: "Livik", emoji: "⛰", aliases: /^(livik|ليفيك)$/i },
  { name: "Karakin", emoji: "🏝", aliases: /^(karakin|كاراكين)$/i },
  { name: "Nusa", emoji: "🏖", aliases: /^(nusa|نوسا)$/i },
];

export function normalizeMapName(word: string): string | null {
  const w = word.trim();
  return SCRIM_MAPS.find((map) => map.aliases.test(w))?.name ?? null;
}

/** Map names in the order they appear, e.g. «Rondo, Miramar, Erangel, Rondo». */
export function parseMapList(text: string): string[] {
  return text
    .split(/[\s,،\-–>|/]+/)
    .map(normalizeMapName)
    .filter((name): name is string => Boolean(name));
}

export function mapEmoji(name: string): string {
  return SCRIM_MAPS.find((map) => map.name === name)?.emoji ?? "";
}

export function mapForRoom(maps: readonly string[], roomIndex: number): string {
  return maps[roomIndex - 1] ?? "";
}
