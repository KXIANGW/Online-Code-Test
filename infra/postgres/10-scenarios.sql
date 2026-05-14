-- Rich test scenario data covering all exam statuses, all verdict types,
-- multi-submission history, and retake deduplication.
--
-- Passwords:  root → Root@1234 | staff (alice/bob/carol) → Test@1234 | candidates → Cand@1234
--
-- Sessions:
--   1  David  (001)  not_started   P1+P4+P7   0/100
--   2  Emma   (002)  in_progress   P2+P5+P8   0/90  (started 40 min ago)
--   3  Frank  (003)  submitted     P1+P4+P7   30/100 (P1=AC, P4=WA, P7=CE)
--   4  Grace  (004)  cancelled     P3+P6+P8   0/90
--   5  Henry  (005)  submitted     P2+P5+P6   60/90  (first exam)
--   6  Henry  (005)  submitted     P1+P4+P7   70/100 (retake, no overlap with sess5)

DO $$
DECLARE
  -- Role IDs (from 09-seed.sql)
  v_role_interviewer BIGINT;
  v_role_setter      BIGINT;
  v_role_candidate   BIGINT;

  -- User IDs
  v_root_id  BIGINT;
  v_alice_id BIGINT;
  v_bob_id   BIGINT;
  v_carol_id BIGINT;
  v_c1_id    BIGINT;  -- David Chang
  v_c2_id    BIGINT;  -- Emma Lin
  v_c3_id    BIGINT;  -- Frank Wu
  v_c4_id    BIGINT;  -- Grace Lee
  v_c5_id    BIGINT;  -- Henry Huang

  -- Problem IDs
  v_p1_id BIGINT;  -- Two Sum            (easy)
  v_p2_id BIGINT;  -- Fibonacci          (easy)
  v_p3_id BIGINT;  -- Palindrome Check   (easy)
  v_p4_id BIGINT;  -- Binary Search      (medium)
  v_p5_id BIGINT;  -- Merge Sorted Arrays(medium)
  v_p6_id BIGINT;  -- Valid Parentheses  (medium)
  v_p7_id BIGINT;  -- LCS                (hard)
  v_p8_id BIGINT;  -- Coin Change        (hard)

  -- Exam session IDs
  v_s1_id BIGINT; v_s2_id BIGINT; v_s3_id BIGINT;
  v_s4_id BIGINT; v_s5_id BIGINT; v_s6_id BIGINT;

  -- exam_session_problems IDs
  v_s3_esp1 BIGINT; v_s3_esp2 BIGINT; v_s3_esp3 BIGINT;
  v_s5_esp1 BIGINT; v_s5_esp2 BIGINT; v_s5_esp3 BIGINT;
  v_s6_esp1 BIGINT; v_s6_esp2 BIGINT; v_s6_esp3 BIGINT;

  -- Submission IDs (session 3 = Frank)
  v_sub_s3p1_1 BIGINT; v_sub_s3p1_2 BIGINT; v_sub_s3p1_3 BIGINT;
  v_sub_s3p2_1 BIGINT;
  v_sub_s3p3_1 BIGINT; v_sub_s3p3_2 BIGINT;

  -- Submission IDs (sessions 5 & 6 = Henry)
  v_sub_s5p1 BIGINT; v_sub_s5p2 BIGINT; v_sub_s5p3 BIGINT;
  v_sub_s6p1 BIGINT; v_sub_s6p2 BIGINT; v_sub_s6p3 BIGINT;

BEGIN
  -- ================================================================
  -- 1. USERS
  -- ================================================================
  SELECT id INTO v_role_interviewer FROM roles WHERE name = 'interviewer';
  SELECT id INTO v_role_setter      FROM roles WHERE name = 'problem_setter';
  SELECT id INTO v_role_candidate   FROM roles WHERE name = 'candidate';

  -- root: superuser, created_by = NULL
  INSERT INTO users (username, password_hash, display_name, is_superuser)
  VALUES ('root', crypt('Root@1234', gen_salt('bf', 10)), 'System Root', TRUE)
  RETURNING id INTO v_root_id;

  -- staff: created by root
  INSERT INTO users (username, password_hash, display_name, created_by)
  VALUES ('alice', crypt('Test@1234', gen_salt('bf', 10)), 'Alice Chen', v_root_id)
  RETURNING id INTO v_alice_id;

  INSERT INTO users (username, password_hash, display_name, created_by)
  VALUES ('bob', crypt('Test@1234', gen_salt('bf', 10)), 'Bob Wang', v_root_id)
  RETURNING id INTO v_bob_id;

  INSERT INTO users (username, password_hash, display_name, created_by)
  VALUES ('carol', crypt('Test@1234', gen_salt('bf', 10)), 'Carol Liu', v_root_id)
  RETURNING id INTO v_carol_id;

  INSERT INTO user_roles (user_id, role_id) VALUES
    (v_alice_id, v_role_interviewer),
    (v_bob_id,   v_role_interviewer),
    (v_bob_id,   v_role_setter),
    (v_carol_id, v_role_setter);

  -- candidates: distributed between alice and bob
  INSERT INTO users (username, password_hash, display_name, created_by)
  VALUES ('candidate_20260509_001', crypt('Cand@1234', gen_salt('bf', 10)), 'David Chang', v_alice_id)
  RETURNING id INTO v_c1_id;

  INSERT INTO users (username, password_hash, display_name, created_by)
  VALUES ('candidate_20260509_002', crypt('Cand@1234', gen_salt('bf', 10)), 'Emma Lin', v_alice_id)
  RETURNING id INTO v_c2_id;

  INSERT INTO users (username, password_hash, display_name, created_by)
  VALUES ('candidate_20260509_003', crypt('Cand@1234', gen_salt('bf', 10)), 'Frank Wu', v_bob_id)
  RETURNING id INTO v_c3_id;

  INSERT INTO users (username, password_hash, display_name, created_by)
  VALUES ('candidate_20260509_004', crypt('Cand@1234', gen_salt('bf', 10)), 'Grace Lee', v_alice_id)
  RETURNING id INTO v_c4_id;

  INSERT INTO users (username, password_hash, display_name, created_by)
  VALUES ('candidate_20260509_005', crypt('Cand@1234', gen_salt('bf', 10)), 'Henry Huang', v_bob_id)
  RETURNING id INTO v_c5_id;

  INSERT INTO user_roles (user_id, role_id) VALUES
    (v_c1_id, v_role_candidate), (v_c2_id, v_role_candidate),
    (v_c3_id, v_role_candidate), (v_c4_id, v_role_candidate),
    (v_c5_id, v_role_candidate);

  -- ================================================================
  -- 2. PROBLEMS
  -- ================================================================

  -- P1: Two Sum (easy) — 3 testcases: 2 public + 1 hidden
  INSERT INTO problems (title, description_md, difficulty, time_limit_ms, memory_limit_mb, created_by)
  VALUES (
    'Two Sum',
    E'## Problem\n\nGiven an array of `n` integers and a target, return the 0-based indices of two numbers that add up to target.\n\n**Input:** Line 1: `n`; Line 2: `n` integers; Line 3: `target`\n**Output:** Two space-separated indices\n\n**Example:**\n```\n4\n2 7 11 15\n9\n```\n→ `0 1`',
    'easy', 1000, 256, v_carol_id
  ) RETURNING id INTO v_p1_id;

  INSERT INTO problem_testcases (problem_id, order_index, is_public, input_data, expected_output) VALUES
    (v_p1_id, 1, TRUE,  E'4\n2 7 11 15\n9', '0 1'),
    (v_p1_id, 2, TRUE,  E'3\n3 2 4\n6',     '1 2'),
    (v_p1_id, 3, FALSE, E'2\n3 3\n6',       '0 1');

  -- P2: Fibonacci (easy) — 3 testcases: 2 public + 1 hidden
  INSERT INTO problems (title, description_md, difficulty, time_limit_ms, memory_limit_mb, created_by)
  VALUES (
    'Fibonacci Sequence',
    E'## Problem\n\nReturn the nth Fibonacci number (0-indexed: F(0)=0, F(1)=1).\n\n**Input:** Single integer `n` (0 ≤ n ≤ 30)\n**Output:** F(n)\n\n**Example:** `5` → `5`',
    'easy', 1000, 128, v_bob_id
  ) RETURNING id INTO v_p2_id;

  INSERT INTO problem_testcases (problem_id, order_index, is_public, input_data, expected_output) VALUES
    (v_p2_id, 1, TRUE,  '5',  '5'),
    (v_p2_id, 2, TRUE,  '10', '55'),
    (v_p2_id, 3, FALSE, '20', '6765');

  -- P3: Palindrome Check (easy) — 3 testcases
  INSERT INTO problems (title, description_md, difficulty, time_limit_ms, memory_limit_mb, created_by)
  VALUES (
    'Palindrome Check',
    E'## Problem\n\nGiven a lowercase string, output `true` if palindrome, else `false`.\n\n**Input:** Single string\n**Output:** `true` or `false`',
    'easy', 1000, 128, v_bob_id
  ) RETURNING id INTO v_p3_id;

  INSERT INTO problem_testcases (problem_id, order_index, is_public, input_data, expected_output) VALUES
    (v_p3_id, 1, TRUE,  'racecar', 'true'),
    (v_p3_id, 2, FALSE, 'hello',   'false'),
    (v_p3_id, 3, FALSE, 'abcba',   'true');

  -- P4: Binary Search (medium) — 4 testcases: 2 public + 2 hidden
  INSERT INTO problems (title, description_md, difficulty, time_limit_ms, memory_limit_mb, created_by)
  VALUES (
    'Binary Search',
    E'## Problem\n\nSearch for `target` in a sorted array. Return 0-based index, or `-1` if not found.\n\n**Input:** Line 1: `n`; Line 2: `n` sorted integers; Line 3: `target`\n**Output:** Index or `-1`',
    'medium', 1000, 256, v_carol_id
  ) RETURNING id INTO v_p4_id;

  INSERT INTO problem_testcases (problem_id, order_index, is_public, input_data, expected_output) VALUES
    (v_p4_id, 1, TRUE,  E'5\n1 3 5 7 9\n5', '2'),
    (v_p4_id, 2, TRUE,  E'5\n1 3 5 7 9\n1', '0'),
    (v_p4_id, 3, FALSE, E'5\n1 3 5 7 9\n4', '-1'),
    (v_p4_id, 4, FALSE, E'1\n7\n7',          '0');

  -- P5: Merge Sorted Arrays (medium) — 3 testcases
  INSERT INTO problems (title, description_md, difficulty, time_limit_ms, memory_limit_mb, created_by)
  VALUES (
    'Merge Sorted Arrays',
    E'## Problem\n\nMerge two sorted integer arrays into one sorted array.\n\n**Input:** Line 1: `n`; Line 2: array A; Line 3: `m`; Line 4: array B\n**Output:** Merged array, space-separated',
    'medium', 1000, 256, v_bob_id
  ) RETURNING id INTO v_p5_id;

  INSERT INTO problem_testcases (problem_id, order_index, is_public, input_data, expected_output) VALUES
    (v_p5_id, 1, TRUE,  E'3\n1 3 5\n3\n2 4 6',  '1 2 3 4 5 6'),
    (v_p5_id, 2, FALSE, E'2\n1 2\n3\n3 4 5',     '1 2 3 4 5'),
    (v_p5_id, 3, FALSE, E'4\n1 3 7 9\n2\n2 8',   '1 2 3 7 8 9');

  -- P6: Valid Parentheses (medium) — 4 testcases: 2 public + 2 hidden
  INSERT INTO problems (title, description_md, difficulty, time_limit_ms, memory_limit_mb, created_by)
  VALUES (
    'Valid Parentheses',
    E'## Problem\n\nDetermine if a string of `()[]{}` is valid.\n\n**Input:** Single string\n**Output:** `true` or `false`',
    'medium', 1000, 256, v_carol_id
  ) RETURNING id INTO v_p6_id;

  INSERT INTO problem_testcases (problem_id, order_index, is_public, input_data, expected_output) VALUES
    (v_p6_id, 1, TRUE,  '()',     'true'),
    (v_p6_id, 2, TRUE,  '()[]{', 'false'),
    (v_p6_id, 3, FALSE, '{[()]}', 'true'),
    (v_p6_id, 4, FALSE, '([)]',   'false');

  -- P7: Longest Common Subsequence (hard) — 4 testcases: 2 public + 2 hidden
  INSERT INTO problems (title, description_md, difficulty, time_limit_ms, memory_limit_mb, created_by)
  VALUES (
    'Longest Common Subsequence',
    E'## Problem\n\nReturn the length of the LCS of two strings.\n\n**Input:** Line 1: s1; Line 2: s2\n**Output:** Integer LCS length',
    'hard', 2000, 512, v_bob_id
  ) RETURNING id INTO v_p7_id;

  INSERT INTO problem_testcases (problem_id, order_index, is_public, input_data, expected_output) VALUES
    (v_p7_id, 1, TRUE,  E'abcde\nace',             '3'),
    (v_p7_id, 2, TRUE,  E'abc\nabc',               '3'),
    (v_p7_id, 3, FALSE, E'abc\ndef',               '0'),
    (v_p7_id, 4, FALSE, E'oxcpqrsvwf\nmynstqcpxa', '5');

  -- P8: Coin Change (hard) — 3 testcases; python3 has stricter 2x override
  INSERT INTO problems (title, description_md, difficulty, time_limit_ms, memory_limit_mb, created_by)
  VALUES (
    'Coin Change',
    E'## Problem\n\nFind minimum coins to reach amount. Return `-1` if impossible.\n\n**Input:** Line 1: `n`; Line 2: denominations; Line 3: `amount`\n**Output:** Min coins or `-1`',
    'hard', 2000, 512, v_carol_id
  ) RETURNING id INTO v_p8_id;

  INSERT INTO problem_language_limits (problem_id, language, time_multiplier, memory_multiplier)
  VALUES (v_p8_id, 'python3', 2.0, 2.0);

  INSERT INTO problem_testcases (problem_id, order_index, is_public, input_data, expected_output) VALUES
    (v_p8_id, 1, TRUE,  E'3\n1 5 10\n11', '2'),
    (v_p8_id, 2, TRUE,  E'1\n2\n3',       '-1'),
    (v_p8_id, 3, FALSE, E'3\n1 2 5\n11',  '3');

  -- ================================================================
  -- 3. EXAM SESSIONS
  -- ================================================================

  -- Session 1: David — not_started
  INSERT INTO exam_sessions (candidate_id, created_by, status, duration_minutes, max_score)
  VALUES (v_c1_id, v_alice_id, 'not_started', 90, 100)
  RETURNING id INTO v_s1_id;

  INSERT INTO exam_session_problems (exam_session_id, problem_id, order_index, score_weight) VALUES
    (v_s1_id, v_p1_id, 1, 30),
    (v_s1_id, v_p4_id, 2, 40),
    (v_s1_id, v_p7_id, 3, 30);

  -- Session 2: Emma — in_progress (started 40 min ago, 90 min limit → 50 min left)
  INSERT INTO exam_sessions (
    candidate_id, created_by, status, duration_minutes,
    actual_start_at, expires_at, max_score
  ) VALUES (
    v_c2_id, v_alice_id, 'in_progress', 90,
    NOW() - INTERVAL '40 minutes',
    NOW() - INTERVAL '40 minutes' + INTERVAL '90 minutes',
    90
  ) RETURNING id INTO v_s2_id;

  INSERT INTO exam_session_problems (exam_session_id, problem_id, order_index, score_weight) VALUES
    (v_s2_id, v_p2_id, 1, 30),
    (v_s2_id, v_p5_id, 2, 30),
    (v_s2_id, v_p8_id, 3, 30);

  -- Session 3: Frank — submitted (3h ago), total=30/100
  INSERT INTO exam_sessions (
    candidate_id, created_by, status, duration_minutes,
    actual_start_at, expires_at, max_score, created_at, updated_at
  ) VALUES (
    v_c3_id, v_bob_id, 'submitted', 120,
    NOW() - INTERVAL '3 hours',
    NOW() - INTERVAL '1 hour',
    100,
    NOW() - INTERVAL '4 hours',
    NOW() - INTERVAL '1 hour'
  ) RETURNING id INTO v_s3_id;

  INSERT INTO exam_session_problems (exam_session_id, problem_id, order_index, score_weight)
  VALUES (v_s3_id, v_p1_id, 1, 30) RETURNING id INTO v_s3_esp1;

  INSERT INTO exam_session_problems (exam_session_id, problem_id, order_index, score_weight)
  VALUES (v_s3_id, v_p4_id, 2, 40) RETURNING id INTO v_s3_esp2;

  INSERT INTO exam_session_problems (exam_session_id, problem_id, order_index, score_weight)
  VALUES (v_s3_id, v_p7_id, 3, 30) RETURNING id INTO v_s3_esp3;

  -- Session 4: Grace — cancelled by alice
  INSERT INTO exam_sessions (candidate_id, created_by, status, duration_minutes, max_score)
  VALUES (v_c4_id, v_alice_id, 'cancelled', 60, 90)
  RETURNING id INTO v_s4_id;

  INSERT INTO exam_session_problems (exam_session_id, problem_id, order_index, score_weight) VALUES
    (v_s4_id, v_p3_id, 1, 30),
    (v_s4_id, v_p6_id, 2, 30),
    (v_s4_id, v_p8_id, 3, 30);

  -- Session 5: Henry first exam — P2(AC,30)+P5(WA,0)+P6(AC,30) = 60/90
  INSERT INTO exam_sessions (
    candidate_id, created_by, status, duration_minutes,
    actual_start_at, expires_at, max_score, created_at, updated_at
  ) VALUES (
    v_c5_id, v_bob_id, 'submitted', 90,
    NOW() - INTERVAL '5 hours',
    NOW() - INTERVAL '3 hours 30 minutes',
    90,
    NOW() - INTERVAL '6 hours',
    NOW() - INTERVAL '3 hours'
  ) RETURNING id INTO v_s5_id;

  INSERT INTO exam_session_problems (exam_session_id, problem_id, order_index, score_weight)
  VALUES (v_s5_id, v_p2_id, 1, 30) RETURNING id INTO v_s5_esp1;

  INSERT INTO exam_session_problems (exam_session_id, problem_id, order_index, score_weight)
  VALUES (v_s5_id, v_p5_id, 2, 30) RETURNING id INTO v_s5_esp2;

  INSERT INTO exam_session_problems (exam_session_id, problem_id, order_index, score_weight)
  VALUES (v_s5_id, v_p6_id, 3, 30) RETURNING id INTO v_s5_esp3;

  -- Session 6: Henry retake — P1(TLE,0)+P4(AC,40)+P7(AC,30) = 70/100
  -- Note: P1/P4/P7 don't overlap with session 5's P2/P5/P6
  INSERT INTO exam_sessions (
    candidate_id, created_by, status, duration_minutes,
    actual_start_at, expires_at, max_score, created_at, updated_at
  ) VALUES (
    v_c5_id, v_bob_id, 'submitted', 90,
    NOW() - INTERVAL '1 hour',
    NOW() + INTERVAL '30 minutes',
    100,
    NOW() - INTERVAL '2 hours',
    NOW() - INTERVAL '30 minutes'
  ) RETURNING id INTO v_s6_id;

  INSERT INTO exam_session_problems (exam_session_id, problem_id, order_index, score_weight)
  VALUES (v_s6_id, v_p1_id, 1, 30) RETURNING id INTO v_s6_esp1;

  INSERT INTO exam_session_problems (exam_session_id, problem_id, order_index, score_weight)
  VALUES (v_s6_id, v_p4_id, 2, 40) RETURNING id INTO v_s6_esp2;

  INSERT INTO exam_session_problems (exam_session_id, problem_id, order_index, score_weight)
  VALUES (v_s6_id, v_p7_id, 3, 30) RETURNING id INTO v_s6_esp3;

  -- ================================================================
  -- 4. SUBMISSIONS — Session 3 (Frank)
  --    P1: sub1=WA, sub2=TLE, sub3=AC  (3 submissions, last=AC=final)
  --    P4: sub1=WA                     (1 submission, WA=final)
  --    P7: sub1=RE, sub2=CE            (2 submissions, CE=final)
  -- ================================================================

  -- Frank P1 sub1: WA
  INSERT INTO submissions (exam_session_problem_id, candidate_id, language, source_code,
    status, verdict, runtime_ms, memory_kb, submitted_at, judged_at)
  VALUES (
    v_s3_esp1, v_c3_id, 'python3',
    E'n=int(input())\nnums=list(map(int,input().split()))\nt=int(input())\nfor i in range(n):\n  for j in range(i+1,n):\n    if nums[i]+nums[j]==t: print(i,j+1);break  # bug: j+1',
    'done', 'WA', 48, 8192,
    NOW()-INTERVAL'2 hours 50 minutes', NOW()-INTERVAL'2 hours 49 minutes')
  RETURNING id INTO v_sub_s3p1_1;

  -- Frank P1 sub2: TLE
  INSERT INTO submissions (exam_session_problem_id, candidate_id, language, source_code,
    status, verdict, runtime_ms, memory_kb, submitted_at, judged_at)
  VALUES (
    v_s3_esp1, v_c3_id, 'python3',
    E'n=int(input())\nnums=list(map(int,input().split()))\nt=int(input())\nwhile True:\n  for i in range(n):\n    for j in range(n):\n      if i!=j and nums[i]+nums[j]==t: print(i,j);break  # infinite outer loop',
    'done', 'TLE', 5000, 8192,
    NOW()-INTERVAL'2 hours 30 minutes', NOW()-INTERVAL'2 hours 29 minutes')
  RETURNING id INTO v_sub_s3p1_2;

  -- Frank P1 sub3: AC (final)
  INSERT INTO submissions (exam_session_problem_id, candidate_id, language, source_code,
    status, verdict, runtime_ms, memory_kb, submitted_at, judged_at)
  VALUES (
    v_s3_esp1, v_c3_id, 'python3',
    E'n=int(input())\nnums=list(map(int,input().split()))\nt=int(input())\nseen={}\nfor i,v in enumerate(nums):\n  if t-v in seen: print(seen[t-v],i);break\n  seen[v]=i',
    'done', 'AC', 42, 9216,
    NOW()-INTERVAL'2 hours 10 minutes', NOW()-INTERVAL'2 hours 9 minutes')
  RETURNING id INTO v_sub_s3p1_3;

  -- Testcase results for Frank P1 AC submission
  INSERT INTO submission_testcase_results (submission_id, testcase_id, verdict, runtime_ms, memory_kb, actual_output)
  SELECT v_sub_s3p1_3, tc.id, 'AC'::testcase_verdict_type,
         40 + tc.order_index, 9000,
         CASE WHEN tc.is_public THEN tc.expected_output ELSE NULL END
  FROM problem_testcases tc WHERE tc.problem_id = v_p1_id;

  -- Frank P4 sub1: WA (final, off-by-one)
  INSERT INTO submissions (exam_session_problem_id, candidate_id, language, source_code,
    status, verdict, runtime_ms, memory_kb, submitted_at, judged_at)
  VALUES (
    v_s3_esp2, v_c3_id, 'cpp17',
    E'#include<iostream>\nusing namespace std;\nint main(){\n  int n;cin>>n;\n  int a[100];\n  for(int i=0;i<n;i++)cin>>a[i];\n  int t;cin>>t;\n  int lo=0,hi=n-1;\n  while(lo<=hi){\n    int mid=(lo+hi)/2;\n    if(a[mid]==t){cout<<mid+1;return 0;}  // bug: mid+1\n    else if(a[mid]<t)lo=mid+1;\n    else hi=mid-1;\n  }\n  cout<<-1;\n}',
    'done', 'WA', 8, 1024,
    NOW()-INTERVAL'1 hour 50 minutes', NOW()-INTERVAL'1 hour 49 minutes')
  RETURNING id INTO v_sub_s3p2_1;

  INSERT INTO submission_testcase_results (submission_id, testcase_id, verdict, runtime_ms, memory_kb, actual_output)
  SELECT v_sub_s3p2_1, tc.id, 'WA'::testcase_verdict_type, 8, 1024,
         CASE WHEN tc.is_public THEN 'wrong' ELSE NULL END
  FROM problem_testcases tc WHERE tc.problem_id = v_p4_id;

  -- Frank P7 sub1: RE
  INSERT INTO submissions (exam_session_problem_id, candidate_id, language, source_code,
    status, verdict, runtime_ms, memory_kb, submitted_at, judged_at)
  VALUES (
    v_s3_esp3, v_c3_id, 'python3',
    E's1=input();s2=input()\nn,m=len(s1),len(s2)\ndp=[[0]*(m+1) for _ in range(n+1)]\nfor i in range(1,n+1):\n  for j in range(1,m+1):\n    if s1[i]==s2[j]: dp[i][j]=dp[i-1][j-1]+1  # IndexError: s1[i] out of range\n    else: dp[i][j]=max(dp[i-1][j],dp[i][j-1])\nprint(dp[n][m])',
    'done', 'RE', 12, 8192,
    NOW()-INTERVAL'1 hour 40 minutes', NOW()-INTERVAL'1 hour 39 minutes')
  RETURNING id INTO v_sub_s3p3_1;

  -- Frank P7 sub2: CE (final)
  INSERT INTO submissions (exam_session_problem_id, candidate_id, language, source_code,
    status, verdict, runtime_ms, memory_kb, submitted_at, judged_at)
  VALUES (
    v_s3_esp3, v_c3_id, 'cpp17',
    E'#include<iostream>\n#include<string>\nusing namespace std;\n// CE: missing return type on function\nlcs(string s1,string s2){\n  int n=s1.size(),m=s2.size();\n  return 0;\n}',
    'done', 'CE', NULL, NULL,
    NOW()-INTERVAL'1 hour 20 minutes', NOW()-INTERVAL'1 hour 19 minutes')
  RETURNING id INTO v_sub_s3p3_2;

  -- Skipped testcase results for CE submission
  INSERT INTO submission_testcase_results (submission_id, testcase_id, verdict, runtime_ms, memory_kb, actual_output)
  SELECT v_sub_s3p3_2, tc.id, 'skipped'::testcase_verdict_type, NULL, NULL, NULL
  FROM problem_testcases tc WHERE tc.problem_id = v_p7_id;

  -- Update session 3 esp + session total
  UPDATE exam_session_problems SET final_submission_id=v_sub_s3p1_3, score=30 WHERE id=v_s3_esp1;
  UPDATE exam_session_problems SET final_submission_id=v_sub_s3p2_1, score=0  WHERE id=v_s3_esp2;
  UPDATE exam_session_problems SET final_submission_id=v_sub_s3p3_2, score=0  WHERE id=v_s3_esp3;
  UPDATE exam_sessions SET total_score=30, updated_at=NOW()-INTERVAL'1 hour' WHERE id=v_s3_id;

  -- ================================================================
  -- 5. SUBMISSIONS — Session 5 (Henry first exam)
  -- ================================================================

  -- Henry P2: AC
  INSERT INTO submissions (exam_session_problem_id, candidate_id, language, source_code,
    status, verdict, runtime_ms, memory_kb, submitted_at, judged_at)
  VALUES (
    v_s5_esp1, v_c5_id, 'cpp17',
    E'#include<iostream>\nusing namespace std;\nint main(){int n;cin>>n;\n  if(n==0){cout<<0;return 0;}\n  if(n==1){cout<<1;return 0;}\n  int a=0,b=1;\n  for(int i=2;i<=n;i++){int c=a+b;a=b;b=c;}\n  cout<<b;}',
    'done', 'AC', 5, 512,
    NOW()-INTERVAL'4 hours 30 minutes', NOW()-INTERVAL'4 hours 29 minutes')
  RETURNING id INTO v_sub_s5p1;

  INSERT INTO submission_testcase_results (submission_id, testcase_id, verdict, runtime_ms, memory_kb, actual_output)
  SELECT v_sub_s5p1, tc.id, 'AC'::testcase_verdict_type, 5, 512,
         CASE WHEN tc.is_public THEN tc.expected_output ELSE NULL END
  FROM problem_testcases tc WHERE tc.problem_id = v_p2_id;

  -- Henry P5: WA (not sorted output)
  INSERT INTO submissions (exam_session_problem_id, candidate_id, language, source_code,
    status, verdict, runtime_ms, memory_kb, submitted_at, judged_at)
  VALUES (
    v_s5_esp2, v_c5_id, 'python3',
    E'n=int(input());a=list(map(int,input().split()))\nm=int(input());b=list(map(int,input().split()))\nprint(*a,*b)  # bug: concatenation without sorting',
    'done', 'WA', 28, 7168,
    NOW()-INTERVAL'4 hours 10 minutes', NOW()-INTERVAL'4 hours 9 minutes')
  RETURNING id INTO v_sub_s5p2;

  INSERT INTO submission_testcase_results (submission_id, testcase_id, verdict, runtime_ms, memory_kb, actual_output)
  SELECT v_sub_s5p2, tc.id, 'WA'::testcase_verdict_type, 28, 7168,
         CASE WHEN tc.is_public THEN 'wrong order' ELSE NULL END
  FROM problem_testcases tc WHERE tc.problem_id = v_p5_id;

  -- Henry P6: AC
  INSERT INTO submissions (exam_session_problem_id, candidate_id, language, source_code,
    status, verdict, runtime_ms, memory_kb, submitted_at, judged_at)
  VALUES (
    v_s5_esp3, v_c5_id, 'python3',
    E's=input();stack=[];m={")":"(","}":"{","]":"["}\nfor c in s:\n  if c in "([{": stack.append(c)\n  elif stack and stack[-1]==m[c]: stack.pop()\n  else: print("false");exit()\nprint("true" if not stack else "false")',
    'done', 'AC', 22, 7168,
    NOW()-INTERVAL'3 hours 30 minutes', NOW()-INTERVAL'3 hours 29 minutes')
  RETURNING id INTO v_sub_s5p3;

  INSERT INTO submission_testcase_results (submission_id, testcase_id, verdict, runtime_ms, memory_kb, actual_output)
  SELECT v_sub_s5p3, tc.id, 'AC'::testcase_verdict_type, 22, 7168,
         CASE WHEN tc.is_public THEN tc.expected_output ELSE NULL END
  FROM problem_testcases tc WHERE tc.problem_id = v_p6_id;

  UPDATE exam_session_problems SET final_submission_id=v_sub_s5p1, score=30 WHERE id=v_s5_esp1;
  UPDATE exam_session_problems SET final_submission_id=v_sub_s5p2, score=0  WHERE id=v_s5_esp2;
  UPDATE exam_session_problems SET final_submission_id=v_sub_s5p3, score=30 WHERE id=v_s5_esp3;
  UPDATE exam_sessions SET total_score=60 WHERE id=v_s5_id;

  -- ================================================================
  -- 6. SUBMISSIONS — Session 6 (Henry retake)
  -- ================================================================

  -- Henry P1: TLE (brute force O(n^2))
  INSERT INTO submissions (exam_session_problem_id, candidate_id, language, source_code,
    status, verdict, runtime_ms, memory_kb, submitted_at, judged_at)
  VALUES (
    v_s6_esp1, v_c5_id, 'python3',
    E'n=int(input());nums=list(map(int,input().split()));t=int(input())\nfor i in range(n):\n  for j in range(n):  # O(n^2) TLEs on large input\n    if i!=j and nums[i]+nums[j]==t: print(i,j);exit()',
    'done', 'TLE', 5000, 9216,
    NOW()-INTERVAL'55 minutes', NOW()-INTERVAL'54 minutes')
  RETURNING id INTO v_sub_s6p1;

  INSERT INTO submission_testcase_results (submission_id, testcase_id, verdict, runtime_ms, memory_kb, actual_output)
  SELECT v_sub_s6p1, tc.id, 'TLE'::testcase_verdict_type, 5000, 9216, NULL
  FROM problem_testcases tc WHERE tc.problem_id = v_p1_id;

  -- Henry P4: AC (correct binary search)
  INSERT INTO submissions (exam_session_problem_id, candidate_id, language, source_code,
    status, verdict, runtime_ms, memory_kb, submitted_at, judged_at)
  VALUES (
    v_s6_esp2, v_c5_id, 'cpp17',
    E'#include<iostream>\nusing namespace std;\nint main(){\n  int n;cin>>n;\n  int a[1000];\n  for(int i=0;i<n;i++)cin>>a[i];\n  int t;cin>>t;\n  int lo=0,hi=n-1;\n  while(lo<=hi){\n    int mid=(lo+hi)/2;\n    if(a[mid]==t){cout<<mid;return 0;}\n    else if(a[mid]<t)lo=mid+1;\n    else hi=mid-1;\n  }\n  cout<<-1;\n}',
    'done', 'AC', 6, 512,
    NOW()-INTERVAL'45 minutes', NOW()-INTERVAL'44 minutes')
  RETURNING id INTO v_sub_s6p2;

  INSERT INTO submission_testcase_results (submission_id, testcase_id, verdict, runtime_ms, memory_kb, actual_output)
  SELECT v_sub_s6p2, tc.id, 'AC'::testcase_verdict_type, 6, 512,
         CASE WHEN tc.is_public THEN tc.expected_output ELSE NULL END
  FROM problem_testcases tc WHERE tc.problem_id = v_p4_id;

  -- Henry P7: AC (correct DP solution)
  INSERT INTO submissions (exam_session_problem_id, candidate_id, language, source_code,
    status, verdict, runtime_ms, memory_kb, submitted_at, judged_at)
  VALUES (
    v_s6_esp3, v_c5_id, 'cpp17',
    E'#include<iostream>\n#include<vector>\n#include<string>\nusing namespace std;\nint main(){\n  string s1,s2;cin>>s1>>s2;\n  int n=s1.size(),m=s2.size();\n  vector<vector<int>>dp(n+1,vector<int>(m+1,0));\n  for(int i=1;i<=n;i++)\n    for(int j=1;j<=m;j++)\n      dp[i][j]=s1[i-1]==s2[j-1]?dp[i-1][j-1]+1:max(dp[i-1][j],dp[i][j-1]);\n  cout<<dp[n][m];\n}',
    'done', 'AC', 18, 4096,
    NOW()-INTERVAL'35 minutes', NOW()-INTERVAL'34 minutes')
  RETURNING id INTO v_sub_s6p3;

  INSERT INTO submission_testcase_results (submission_id, testcase_id, verdict, runtime_ms, memory_kb, actual_output)
  SELECT v_sub_s6p3, tc.id, 'AC'::testcase_verdict_type, 18, 4096,
         CASE WHEN tc.is_public THEN tc.expected_output ELSE NULL END
  FROM problem_testcases tc WHERE tc.problem_id = v_p7_id;

  UPDATE exam_session_problems SET final_submission_id=v_sub_s6p1, score=0  WHERE id=v_s6_esp1;
  UPDATE exam_session_problems SET final_submission_id=v_sub_s6p2, score=40 WHERE id=v_s6_esp2;
  UPDATE exam_session_problems SET final_submission_id=v_sub_s6p3, score=30 WHERE id=v_s6_esp3;
  UPDATE exam_sessions SET total_score=70 WHERE id=v_s6_id;

END $$;
