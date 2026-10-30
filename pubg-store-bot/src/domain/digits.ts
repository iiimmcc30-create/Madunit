const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";

export function normalizeDigits(input: string): string {
  return input.replace(/[٠-٩]/g, (digit) => String(ARABIC_INDIC.indexOf(digit)));
}
