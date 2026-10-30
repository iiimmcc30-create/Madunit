import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtractedFields } from "../domain/extract";
import { buildCoverCard, type CoverCard } from "./model";
import { parseCoverTheme, type CoverTheme } from "./theme";

export interface CoverGenerator {
  render(listing: {
    shortCode: string;
    price: { toNumber(): number } | number;
    extractedFields: unknown;
    store: { coverTheme?: unknown };
  }): Promise<Buffer | null>;
}

function fontPath(): string | null {
  const candidates = [
    join(process.cwd(), "assets/fonts/NotoNaskhArabic-Regular.ttf"),
    join(
      process.cwd(),
      "node_modules/@fontsource/noto-naskh-arabic/files/noto-naskh-arabic-arabic-400-normal.woff",
    ),
  ];
  return candidates.find((file) => existsSync(file)) ?? null;
}

function h(
  type: string,
  props: Record<string, unknown>,
  ...children: unknown[]
): { type: string; props: Record<string, unknown> } {
  const flat = children.flat().filter((child) => child != null);
  return {
    type,
    props: {
      ...props,
      children: flat.length <= 1 ? flat[0] : flat,
    },
  };
}

export function coverTree(card: CoverCard, theme: CoverTheme) {
  return h(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        width: "1200px",
        height: "630px",
        padding: "56px",
        background: theme.background,
        color: theme.text,
        direction: "rtl",
      },
    },
    h(
      "div",
      { style: { display: "flex", justifyContent: "space-between", fontSize: 28 } },
      theme.title,
      card.shortCode,
    ),
    h(
      "div",
      { style: { display: "flex", flexDirection: "column" } },
      card.level
        ? h("div", { style: { fontSize: 72, color: theme.accent, fontWeight: 700 } }, card.level)
        : null,
      card.skins ? h("div", { style: { fontSize: 36, marginTop: 16 } }, card.skins) : null,
    ),
    h("div", { style: { fontSize: 56, color: theme.accent, fontWeight: 700 } }, card.priceLabel),
  );
}

export function createSatoriCoverGenerator(): CoverGenerator {
  return {
    async render(listing) {
      const fontFile = fontPath();
      if (!fontFile) return null;
      try {
        const satori = (await import("satori")).default;
        const { Resvg } = await import("@resvg/resvg-js");
        const theme = parseCoverTheme(listing.store.coverTheme);
        const price = typeof listing.price === "number" ? listing.price : listing.price.toNumber();
        const card = buildCoverCard({
          shortCode: listing.shortCode,
          price,
          extracted: (listing.extractedFields ?? {}) as ExtractedFields,
          theme,
        });
        const svg = await satori(coverTree(card, theme) as never, {
          width: 1200,
          height: 630,
          fonts: [
            {
              name: "Noto Naskh Arabic",
              data: readFileSync(fontFile),
              weight: 400,
              style: "normal",
            },
          ],
        });
        return Buffer.from(new Resvg(svg).render().asPng());
      } catch {
        return null;
      }
    },
  };
}
