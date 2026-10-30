import {
  heuristicExtractRoomCredentials,
  heuristicExtractScrimOpen,
  mergeScrimOpenExtract,
} from "../domain/scrim-parse";
import { parseScrimRoomResult } from "../domain/scrim-parse";
import type { RoomCredentials, ScrimOpenExtract, ScrimRoomResult } from "../domain/scrim-types";
import type { LlmProvider } from "./types";

export async function extractScrimOpenWithLlm(llm: LlmProvider, text: string): Promise<ScrimOpenExtract> {
  const heuristic = heuristicExtractScrimOpen(text);
  try {
    const extra = llm.extractScrimOpen ? await llm.extractScrimOpen(text) : null;
    return mergeScrimOpenExtract(heuristic, extra);
  } catch {
    return heuristic;
  }
}

export async function extractRoomCredentialsWithLlm(
  llm: LlmProvider,
  text: string,
): Promise<RoomCredentials | null> {
  const heuristic = heuristicExtractRoomCredentials(text);
  if (heuristic) return heuristic;
  try {
    return llm.extractRoomCredentials ? await llm.extractRoomCredentials(text) : null;
  } catch {
    return null;
  }
}

export async function readStandingsWithLlm(
  llm: LlmProvider,
  imageUrl: string,
): Promise<ScrimRoomResult | null> {
  if (!llm.readScrimStandingsImage) return null;
  try {
    const raw = await llm.readScrimStandingsImage(imageUrl);
    return parseScrimRoomResult(raw);
  } catch {
    return null;
  }
}
