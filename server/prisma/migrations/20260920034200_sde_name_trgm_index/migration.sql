-- Name search on SdeRecord is an ILIKE '%...%' against the localized name
-- inside the JSONB payload, which no btree index can serve. A trigram GIN
-- index makes it fast.
--
-- Partial on purpose: a release has ~100 datasets and several million rows,
-- but only `types` and `groups` are ever searched by name. Indexing just
-- those keeps the index small enough to stay in cache and keeps the bulk
-- ingest fast, since the other datasets don't pay for index maintenance.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "sde_record_name_trgm_idx" ON "SdeRecord"
  USING gin ((("data"->'name'->>'en')) gin_trgm_ops)
  WHERE "dataset" IN ('types', 'groups');
