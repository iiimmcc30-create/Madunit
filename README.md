# madunitstore-site
Snapshot (2026-10-30) of madunitstore.com from OVH VPS 15.235.90.242.
- `landing/` — static site served by Caddy from /opt/landing (mounted at /srv/landing).
- `pubg-store-bot/` — /opt/pubg-store-bot working tree (Node/TS Telegram bot + web dashboard, Postgres/Prisma, Redis, Caddy via docker-compose.prod.yml, deploy/Caddyfile). Also tracked in iiimmcc30-create/pubg-store-bot.
Secrets (.env), DB dumps, backups, node_modules, certs excluded.
