-- Per-testcase judge output; actual_output stored ONLY for public testcases
CREATE TABLE submission_testcase_results (
  id            BIGSERIAL             PRIMARY KEY,
  submission_id BIGINT                NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  testcase_id   BIGINT                NOT NULL REFERENCES problem_testcases(id),
  verdict       testcase_verdict_type NOT NULL,
  runtime_ms    INT,
  memory_kb     INT,
  actual_output TEXT,
  created_at    TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
  UNIQUE (submission_id, testcase_id)
);
