export function estimateCostUsd(
  inputTokens: number,
  outputTokens: number,
  inputPerMillion: number,
  outputPerMillion: number,
): number {
  return (inputTokens / 1_000_000) * inputPerMillion + (outputTokens / 1_000_000) * outputPerMillion;
}

export function estimateTokensFromText(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
