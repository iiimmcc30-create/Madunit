export interface CoverTheme {
  title: string;
  background: string;
  accent: string;
  text: string;
}

export const DEFAULT_COVER_THEME: CoverTheme = {
  title: "حساب ببجي",
  background: "#0B1220",
  accent: "#E8B923",
  text: "#F8FAFC",
};

export function parseCoverTheme(raw: unknown): CoverTheme {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    title: typeof value.title === "string" && value.title.trim() ? value.title : DEFAULT_COVER_THEME.title,
    background:
      typeof value.background === "string" && value.background.trim()
        ? value.background
        : DEFAULT_COVER_THEME.background,
    accent:
      typeof value.accent === "string" && value.accent.trim() ? value.accent : DEFAULT_COVER_THEME.accent,
    text: typeof value.text === "string" && value.text.trim() ? value.text : DEFAULT_COVER_THEME.text,
  };
}
