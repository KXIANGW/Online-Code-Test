-- Add reversible encrypted password column so interviewers can retrieve candidate credentials.
-- Encrypted with AES-256-GCM using the server ENCRYPTION_SECRET key.
-- NULL for users created before this migration (backfill below covers seed users).
ALTER TABLE users ADD COLUMN IF NOT EXISTS encrypted_password TEXT;

-- Backfill encrypted_password for seed users created by 10-scenarios.sql.
-- Values are AES-256-GCM ciphertexts computed with the default ENCRYPTION_SECRET
-- (000102030405060708090a0b0c0d0e0f000102030405060708090a0b0c0d0e0f).
-- If you use a custom ENCRYPTION_SECRET, regenerate these values with encryptPassword().
UPDATE users SET encrypted_password = 'Z7EfmwvmRirC1Sqx:UiHInBs+lP31ZfV37tIQQg==:TRmLlaS+5kNp'
  WHERE username = 'root' AND encrypted_password IS NULL;

UPDATE users SET encrypted_password = 'R67XlADftYeFaAkW:0iPLHq+j1bR3CsrURsmazg==:7q7jR6LKfw+A'
  WHERE username IN ('alice', 'bob', 'carol') AND encrypted_password IS NULL;

UPDATE users SET encrypted_password = 'pkGRJj83jkSgKnd0:XPHrP1lTsERlqjureEIfrg==:UZpm9WI/NbZH'
  WHERE username IN (
    'candidate_20260509_001', 'candidate_20260509_002', 'candidate_20260509_003',
    'candidate_20260509_004', 'candidate_20260509_005'
  ) AND encrypted_password IS NULL;
