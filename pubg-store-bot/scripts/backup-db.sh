#!/bin/sh
set -eu
# نسخ احتياطي لقاعدة PostgreSQL من حاوية الإنتاج.
# الاستخدام من مجلد المشروع:
#   sh scripts/backup-db.sh
# أو:
#   COMPOSE_FILE=docker-compose.prod.yml sh scripts/backup-db.sh

ROOT=$(cd "$(dirname "$0")/.." && pwd)
COMPOSE_FILE=${COMPOSE_FILE:-"$ROOT/docker-compose.prod.yml"}
OUTDIR=${BACKUP_DIR:-"$ROOT/backups"}
KEEP=${BACKUP_KEEP:-14}

mkdir -p "$OUTDIR"
FILE="$OUTDIR/pubg_store_$(date -u +%Y%m%dT%H%M%SZ).sql.gz"

docker compose -f "$COMPOSE_FILE" exec -T postgres pg_dump -U pubg pubg_store | gzip > "$FILE"

# أبقِ آخر KEEP ملفات فقط
ls -1t "$OUTDIR"/pubg_store_*.sql.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
  rm -f "$old"
done

echo "wrote $FILE"
