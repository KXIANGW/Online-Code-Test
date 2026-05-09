-- 5 custom enum types used across all modules
CREATE TYPE difficulty_level AS ENUM ('easy', 'medium', 'hard');

CREATE TYPE exam_status AS ENUM (
  'not_started',
  'in_progress',
  'submitted',
  'expired',
  'cancelled'
);

CREATE TYPE submission_status AS ENUM (
  'pending',
  'judging',
  'done',
  'system_error'
);

CREATE TYPE verdict_type AS ENUM (
  'AC', 'WA', 'TLE', 'MLE', 'RE', 'CE'
);

-- skipped = short-circuit when an earlier testcase already failed
CREATE TYPE testcase_verdict_type AS ENUM (
  'AC', 'WA', 'TLE', 'MLE', 'RE', 'skipped'
);
