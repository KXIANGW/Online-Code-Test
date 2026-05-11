DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'submission_type') THEN
    CREATE TYPE submission_type AS ENUM ('simple', 'formal');
  END IF;
END $$;

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS submission_type submission_type NOT NULL DEFAULT 'formal';
