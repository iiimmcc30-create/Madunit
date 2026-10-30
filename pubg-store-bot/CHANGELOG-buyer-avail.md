# Buyer availability vs publish draft (2026-10-26 Asia/Riyadh)

## Root cause
1. heuristic listingActor treated any video/photo as sell → start_listing
2. create.ts auto-bound buyer as seller on media and reattached pending media on later «موجود»
3. «موجود ولا انباع» matched SOLD → mark_sold confirm for sellers
4. Non-channel forwards (محولة من DM_bot) skipped channel resolve and went to draft path
5. AVAIL regex matched «توفر» inside «متوفر تابي»

## Fix
- heuristic: hard buyerLookup guard (availability / forward / pasted store ad) → search|inquire, never start_listing
- create: bind seller only on clear sell intent; strip pending media+draft on buyer lookup
- intent/inquiry: forwarded ads (incl. from bot) forced to lookup without media
- prompt: clarify buyer forward/موجود ≠ مسودة
- seller paste+media still start_listing; أبي أبيع still works

## Deploy
OVH 15.235.90.242 docker compose prod rebuild+recreate bot — healthy
