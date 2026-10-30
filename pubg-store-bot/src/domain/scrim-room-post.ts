export type RoomIdChannelMode = "notice" | "full" | "id_only";

export function resolveRoomIdMode(template: { roomIdChannelMode?: string | null; postRoomPassToChannel?: boolean }): RoomIdChannelMode {
  if (template.roomIdChannelMode === "id_only" || template.roomIdChannelMode === "full") return template.roomIdChannelMode;
  return template.postRoomPassToChannel ? "full" : "notice";
}

/** Room message for the public channel: same template but every line mentioning the password removed. */
export function stripPasswordLines(roomIdTemplate: string): string {
  return roomIdTemplate
    .split(/\r?\n/)
    .filter((line) => !/\{pass\}/i.test(line))
    .join("\n");
}

/**
 * When to post the public Id: room 1 at (scrim start − lead). Later rooms, or no known start → now.
 * Returns null for "now".
 */
export function roomChannelPostAt(
  input: { roomIndex: number; startsAt: Date | null; leadMinutes: number },
  now: Date,
): Date | null {
  if (input.roomIndex !== 1 || !input.startsAt) return null;
  const at = new Date(input.startsAt.getTime() - Math.max(0, input.leadMinutes) * 60_000);
  return at.getTime() > now.getTime() ? at : null;
}
