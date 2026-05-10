-- Static reference data: roles, permissions, bindings, language defaults.
-- Users and test scenarios are in 10-scenarios.sql.

INSERT INTO roles (name, description) VALUES
  ('interviewer',    '面試主管：建立面試者帳號、派題、查看結果'),
  ('problem_setter', '出題主管：建立與管理題目'),
  ('candidate',      '面試者：參加考試');

INSERT INTO permissions (code, description) VALUES
  ('problem:manage', '建立、編輯、刪除題目與測資'),
  ('exam:manage',    '建立面試者帳號、派題、查看所有面試者結果'),
  ('exam:take',      '參加考試、提交程式碼、查看自己的結果');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE (r.name = 'interviewer'    AND p.code = 'exam:manage')
   OR (r.name = 'problem_setter' AND p.code = 'problem:manage')
   OR (r.name = 'candidate'      AND p.code = 'exam:take');

INSERT INTO language_defaults (language, display_name, time_multiplier, memory_multiplier) VALUES
  ('cpp17',   'C++17',    1.0, 1.0),
  ('python3', 'Python 3', 3.0, 2.0);
