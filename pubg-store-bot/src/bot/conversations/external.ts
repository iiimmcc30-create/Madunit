import { AppError } from "../../domain/errors";
import type { ListingConversation } from "../context";

type ExternalOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; app: { message: string; userMessage: string; code: string } };

/**
 * conversation.external serializes thrown errors, so AppError arrives as a plain Error
 * and its Arabic userMessage is lost. Run the op inside external, return AppError as data,
 * then rebuild it on the conversation side so callers can keep `instanceof AppError`.
 */
export async function externalApp<T>(
  conversation: Pick<ListingConversation, "external">,
  op: () => T | Promise<T>,
): Promise<T> {
  const outcome = await conversation.external(async (): Promise<ExternalOutcome<T>> => {
    try {
      return { ok: true, value: await op() };
    } catch (error) {
      if (error instanceof AppError) {
        return { ok: false, app: { message: error.message, userMessage: error.userMessage, code: error.code } };
      }
      throw error;
    }
  });
  if (!outcome.ok) throw new AppError(outcome.app.message, outcome.app.userMessage, outcome.app.code);
  return outcome.value;
}
