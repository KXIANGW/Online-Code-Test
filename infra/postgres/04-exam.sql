-- Exam module: exam_sessions and exam_session_problems
-- NOTE: final_submission_id has NO FK constraint here; the circular FK to
-- submissions is added in 07-alter-esp.sql after submissions table exists.
CREATE TABLE exam_sessions (
  id               BIGSERIAL   PRIMARY KEY,
  candidate_id     BIGINT      NOT NULL REFERENCES users(id),
  created_by       BIGINT      NOT NULL REFERENCES users(id),
  status           exam_status NOT NULL DEFAULT 'not_started',
  duration_minutes INT         NOT NULL CHECK (duration_minutes > 0),
  actual_start_at  TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ,
  total_score      INT         NOT NULL DEFAULT 0,
  max_score        INT         NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE exam_session_problems (
  id                  BIGSERIAL   PRIMARY KEY,
  exam_session_id     BIGINT      NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  problem_id          BIGINT      NOT NULL REFERENCES problems(id),
  order_index         INT         NOT NULL,
  score_weight        INT         NOT NULL CHECK (score_weight >= 0),
  final_submission_id BIGINT,      -- FK to submissions added in 07-alter-esp.sql
  score               INT         NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (exam_session_id, order_index),
  UNIQUE (exam_session_id, problem_id)
);
