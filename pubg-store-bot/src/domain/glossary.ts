import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface GlossaryEntry {
  term: string;
  meaning: string;
  aliases?: string[];
}

let cachedGlobal: GlossaryEntry[] | null = null;

function isEntry(value: unknown): value is GlossaryEntry {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.term === "string" && typeof row.meaning === "string";
}

export function parseGlossary(raw: unknown): GlossaryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: GlossaryEntry[] = [];
  for (const item of raw) {
    if (!isEntry(item)) continue;
    const term = item.term.trim();
    const meaning = item.meaning.trim();
    if (!term || !meaning) continue;
    const aliases = Array.isArray(item.aliases)
      ? item.aliases.map((alias) => String(alias).trim()).filter(Boolean)
      : [];
    out.push({ term, meaning, aliases });
  }
  return out;
}

export function parseGlossaryText(text: string): GlossaryEntry[] {
  const entries: GlossaryEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const split = trimmed.split(/\s*[=:]\s*/, 2);
    if (split.length < 2) continue;
    const term = split[0].trim();
    const meaning = split[1].trim();
    if (term && meaning) entries.push({ term, meaning });
  }
  return entries;
}

export function mergeGlossary(global: GlossaryEntry[], custom: GlossaryEntry[]): GlossaryEntry[] {
  const map = new Map<string, GlossaryEntry>();
  for (const entry of [...global, ...custom]) {
    map.set(entry.term.trim().toLowerCase(), entry);
  }
  return [...map.values()];
}

export function loadGlobalGlossary(baseDir = process.cwd()): GlossaryEntry[] {
  if (cachedGlobal) return cachedGlobal;
  const candidates = [
    join(baseDir, "data", "glossary.json"),
    join(baseDir, "..", "data", "glossary.json"),
    join(__dirname, "..", "..", "data", "glossary.json"),
    join(__dirname, "../../data/glossary.json"),
  ];
  for (const file of candidates) {
    try {
      cachedGlobal = parseGlossary(JSON.parse(readFileSync(file, "utf8")));
      return cachedGlobal;
    } catch {
      // جرّب المسار التالي
    }
  }
  cachedGlobal = [];
  return cachedGlobal;
}

export function formatGlossaryForPrompt(entries: GlossaryEntry[]): string {
  return entries
    .map((entry) => {
      const aliases = entry.aliases?.length ? ` (أسماء ثانية: ${entry.aliases.join("، ")})` : "";
      return `- ${entry.term}${aliases}: ${entry.meaning}`;
    })
    .join("\n");
}

export function expandQueryTerms(query: string, glossary: GlossaryEntry[]): string[] {
  const text = query.trim().toLowerCase();
  const terms = new Set<string>([query.trim()]);
  for (const entry of glossary) {
    const haystack = [entry.term, ...(entry.aliases ?? [])];
    if (haystack.some((item) => text.includes(item.toLowerCase()))) {
      for (const item of haystack) terms.add(item);
      terms.add(entry.meaning);
    }
  }
  return [...terms].filter(Boolean);
}

export function answerGlossaryQuestion(question: string, glossary: GlossaryEntry[]): string | null {
  const text = question.trim().toLowerCase();
  if (!/(وش|ايش|إيش|شنو|ما معنى|معناه|فرق|يعني)/.test(text)) return null;
  const hits = glossary.filter((entry) => {
    const keys = [entry.term, ...(entry.aliases ?? [])];
    return keys.some((key) => text.includes(key.toLowerCase()));
  });
  if (hits.length === 0) return null;
  return hits.map((entry) => `${entry.term}: ${entry.meaning}`).join("\n");
}
