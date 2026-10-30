import type { Api } from "grammy";
import { renderOpenDetails, renderRosterCaption, type ScrimTemplateView, type ScrimWithRelations } from "../../services/scrim";

/** After the open post: optional details message in the channel, and an empty slot list in the organizers group. */
export async function afterScrimOpened(
  api: Api,
  template: ScrimTemplateView,
  scrim: ScrimWithRelations,
  channelId: string,
): Promise<void> {
  const details = renderOpenDetails(template, scrim);
  if (details) {
    await api.sendMessage(channelId, details).catch(() => undefined);
  }
  if (template.organizersGroupId) {
    const empty = renderRosterCaption(template, scrim, { forceEmptySlots: true });
    await api.sendMessage(template.organizersGroupId, empty).catch(() => undefined);
  }
}
