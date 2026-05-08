-- Runs once on a fresh data volume (mounted at /docker-entrypoint-initdb.d/).
-- Keep this minimal; application schema lives in backend Drizzle migrations.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
