export const BRAND_NAME = "سهران بوت";
export const BRAND_NAVY = "#0A1A3F";
export const BRAND_BLUE = "#2F7BFF";

export function telegramHref(raw: string, fallbackUsername = ""): string {
  const value = (raw || fallbackUsername).trim();
  if (!value) return "https://t.me";
  if (/^https?:\/\//i.test(value)) return value;
  const user = value.replace(/^@/, "").replace(/^t\.me\//i, "");
  return `https://t.me/${user}`;
}

export function logoSvg(size = 64): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}" role="img" aria-label="${BRAND_NAME}">
  <rect width="64" height="64" rx="18" fill="${BRAND_NAVY}"/>
  <circle cx="32" cy="36" r="18" fill="#10244f" stroke="${BRAND_BLUE}" stroke-width="2"/>
  <rect x="29" y="12" width="6" height="10" rx="3" fill="${BRAND_BLUE}"/>
  <circle cx="32" cy="12" r="3.4" fill="#8cb6ff"/>
  <circle cx="25.5" cy="34" r="4.2" fill="${BRAND_BLUE}">
    <animate attributeName="opacity" values="0.55;1;0.55" dur="2.4s" repeatCount="indefinite"/>
  </circle>
  <circle cx="38.5" cy="34" r="4.2" fill="${BRAND_BLUE}">
    <animate attributeName="opacity" values="0.55;1;0.55" dur="2.4s" begin="0.4s" repeatCount="indefinite"/>
  </circle>
  <path d="M24 44c2.6 3.4 7 5 8 5s5.4-1.6 8-5" fill="none" stroke="#d7e6ff" stroke-width="1.8" stroke-linecap="round"/>
</svg>`;
}

export function faviconSvg(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>${logoSvg(32)}`;
}

export function ogSvg(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <rect width="1200" height="630" fill="${BRAND_NAVY}"/>
  <circle cx="980" cy="120" r="220" fill="${BRAND_BLUE}" opacity="0.16"/>
  <circle cx="160" cy="540" r="180" fill="${BRAND_BLUE}" opacity="0.12"/>
  <g transform="translate(120 215) scale(3.2)">${logoSvg(64).replace(/<\/?svg[^>]*>/g, "")}</g>
  <text x="360" y="300" fill="#ffffff" font-size="56" font-family="Tahoma, Arial, sans-serif" font-weight="700">سهران بوت</text>
  <text x="360" y="370" fill="#9ec2ff" font-size="36" font-family="Tahoma, Arial, sans-serif">وكيلك الذكي لقناتك</text>
</svg>`;
}
