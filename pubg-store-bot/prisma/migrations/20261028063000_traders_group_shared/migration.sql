-- Allow multiple stores to share the same traders Telegram group.
DROP INDEX IF EXISTS "Store_tradersGroupId_key";
CREATE INDEX IF NOT EXISTS "Store_tradersGroupId_idx" ON "Store"("tradersGroupId");
