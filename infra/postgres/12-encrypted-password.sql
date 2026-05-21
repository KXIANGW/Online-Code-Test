-- Add reversible encrypted password column so interviewers can retrieve candidate credentials.
-- Encrypted with AES-256-GCM using the server ENCRYPTION_SECRET key.
-- NULL for users created before this migration.
ALTER TABLE users ADD COLUMN IF NOT EXISTS encrypted_password TEXT;
