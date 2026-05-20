-- Submission module: one row per candidate submit action
CREATE TABLE submissions (
  id                      BIGSERIAL         PRIMARY KEY,
  exam_session_problem_id BIGINT            NOT NULL REFERENCES exam_session_problems(id) ON DELETE CASCADE,
  candidate_id            BIGINT            NOT NULL REFERENCES users(id),
  language                VARCHAR(32)       NOT NULL REFERENCES language_defaults(language),
  source_code             TEXT              NOT NULL,
  submission_type          submission_type   NOT NULL DEFAULT 'formal',
  status                  submission_status NOT NULL DEFAULT 'pending',
  verdict                 verdict_type,
  runtime_ms              INT,
  memory_kb               INT,
  submitted_at            TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  judged_at               TIMESTAMPTZ
);
