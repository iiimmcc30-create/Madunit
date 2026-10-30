# Channel sync + traders sold (2026-10-25)

## Features
1. Letter+digit short codes (F1442 etc.); Store.listingPrefix (default A)
2. `/sync_channel` — probe channel history via forwardMessage (Bot API has no getChatHistory)
3. Auto soft-sync after /setup|/bind (async, non-blocking)
4. TradersMirrorMap: tradersGroupMessageId → channelMessageId (+ shortCode)
5. Sold detection in traders group (edit/new): strikethrough / تم البيع → channel notice `~~ref~~` + ✅ تم البيع; markSold if Listing exists

## Owner usage
- Open DM with the store bot first (`/start`) so forward probes can land in scratch chat
- `/sync_channel` — walk ~250 recent channel messages
- `/sync_channel F1442` — set prefix/seq from last known code, then walk
- Forward a channel post then `/sync_channel` (or include forward as command context) to seed message id

## Limits / follow-up
- Full ancient history may need a seed message id (forward an old post) or repeated syncs walking further
- Hash-only ads (#6930) are identities for sold mapping; Listing import requires letter codes
- Bot must be channel admin with forward rights; owner must have opened private chat with bot

## Fix 2026-10-25 (traders sold strike + reply)

- Detect Telegram `MessageEntity` type `strikethrough` (edits no longer miss sold)
- Reply «تم البيع» resolves original ad via `reply_to_message` map lookup
- When channelMessageId known: editMessageCaption/Text to HTML strike + ✅ تم البيع, then sendMessage ✅ تم البيع as reply_to that ad
- No orphan channel spam when map missing
- Dedupe by original tradersMessageId / channelMessageId / identity
- Applies to both TRADERS_MIRROR bots (DMSTOR_bot + sarhstoree_bot) in shared container
