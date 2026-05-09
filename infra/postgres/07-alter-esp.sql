-- Completes the circular FK: exam_session_problems.final_submission_id → submissions.id
-- DEFERRABLE INITIALLY DEFERRED allows both rows in a transaction without
-- worrying about insertion order (checked at COMMIT time, not immediately).
ALTER TABLE exam_session_problems
  ADD CONSTRAINT fk_esp_final_submission
  FOREIGN KEY (final_submission_id)
  REFERENCES submissions(id)
  DEFERRABLE INITIALLY DEFERRED;
