-- All indexes beyond PK / UNIQUE auto-indexes (from PLAN.md §8)

-- IAM
CREATE INDEX idx_users_deleted_at        ON users(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_user_roles_user_id      ON user_roles(user_id);
CREATE INDEX idx_user_roles_role_id      ON user_roles(role_id);

-- Problem
CREATE INDEX idx_problems_difficulty     ON problems(difficulty) WHERE deleted_at IS NULL;
CREATE INDEX idx_problems_created_by     ON problems(created_by);
CREATE INDEX idx_problem_testcases_prob  ON problem_testcases(problem_id, order_index);

-- Exam
CREATE INDEX idx_exam_sessions_candidate  ON exam_sessions(candidate_id, created_at DESC);
CREATE INDEX idx_exam_sessions_created_by ON exam_sessions(created_by);
CREATE INDEX idx_exam_sessions_status     ON exam_sessions(status);
CREATE INDEX idx_esp_session              ON exam_session_problems(exam_session_id, order_index);
CREATE INDEX idx_esp_problem              ON exam_session_problems(problem_id);

-- Submission
CREATE INDEX idx_submissions_esp       ON submissions(exam_session_problem_id, submitted_at DESC);
CREATE INDEX idx_submissions_candidate ON submissions(candidate_id, submitted_at DESC);
CREATE INDEX idx_submissions_status    ON submissions(status) WHERE status IN ('pending', 'judging');
CREATE INDEX idx_str_submission        ON submission_testcase_results(submission_id);
