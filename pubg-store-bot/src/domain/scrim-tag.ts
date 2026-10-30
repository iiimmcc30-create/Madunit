const TAG_MAX = 16;

export function normalizeScrimTag(raw: string): string | null {
  const upper = raw
    .trim()
    .replace(/^@+/, "")
    .replace(/[\s.\-|/\\]+/g, "")
    .replace(/[^\p{L}\p{N}_]/gu, "")
    .toUpperCase();
  if (upper.length < 2 || upper.length > TAG_MAX) return null;
  return upper;
}

export function compactPhrase(text: string): string {
  return text.replace(/\s+/g, "").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
}

export function isCommitPhrase(text: string, expected = "ملتزمين"): boolean {
  return compactPhrase(text) === compactPhrase(expected);
}
