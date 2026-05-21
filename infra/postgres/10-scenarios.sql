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
  -- new added 5 problems
  v_p9_id BIGINT;   -- Container With Most Water (medium)
  v_p10_id BIGINT;  -- Longest Substring Without Repeating Characters (medium)
  v_p11_id BIGINT;  -- Edit Distance (hard)
  v_p12_id BIGINT;  -- Sliding Window Maximum (hard)
  v_p13_id BIGINT;  -- N-Queens (hard)

  -- Exam session IDs
  v_e1_id BIGINT; v_e2_id BIGINT; v_e3_id BIGINT;
  v_e4_id BIGINT; v_e5_id BIGINT; v_e6_id BIGINT;
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
  -- encrypted_password: AES-256-GCM of 'Root@1234' with default ENCRYPTION_SECRET
  INSERT INTO users (username, password_hash, display_name, is_superuser, encrypted_password)
  VALUES ('root', crypt('Root@1234', gen_salt('bf', 10)), 'System Root', TRUE,
          'Z7EfmwvmRirC1Sqx:UiHInBs+lP31ZfV37tIQQg==:TRmLlaS+5kNp')
  RETURNING id INTO v_root_id;

  -- staff: created by root
  -- encrypted_password: AES-256-GCM of 'Test@1234' with default ENCRYPTION_SECRET
  INSERT INTO users (username, password_hash, display_name, created_by, encrypted_password)
  VALUES ('alice', crypt('Test@1234', gen_salt('bf', 10)), 'Alice Chen', v_root_id,
          'R67XlADftYeFaAkW:0iPLHq+j1bR3CsrURsmazg==:7q7jR6LKfw+A')
  RETURNING id INTO v_alice_id;

  INSERT INTO users (username, password_hash, display_name, created_by, encrypted_password)
  VALUES ('bob', crypt('Test@1234', gen_salt('bf', 10)), 'Bob Wang', v_root_id,
          'R67XlADftYeFaAkW:0iPLHq+j1bR3CsrURsmazg==:7q7jR6LKfw+A')
  RETURNING id INTO v_bob_id;

  INSERT INTO users (username, password_hash, display_name, created_by, encrypted_password)
  VALUES ('carol', crypt('Test@1234', gen_salt('bf', 10)), 'Carol Liu', v_root_id,
          'R67XlADftYeFaAkW:0iPLHq+j1bR3CsrURsmazg==:7q7jR6LKfw+A')
  RETURNING id INTO v_carol_id;

  INSERT INTO user_roles (user_id, role_id) VALUES
    (v_alice_id, v_role_interviewer),
    (v_bob_id,   v_role_interviewer),
    (v_bob_id,   v_role_setter),
    (v_carol_id, v_role_setter);

  -- candidates: distributed between alice and bob
  -- encrypted_password: AES-256-GCM of 'Cand@1234' with default ENCRYPTION_SECRET
  INSERT INTO users (username, password_hash, display_name, created_by, encrypted_password)
  VALUES ('candidate_20260509_001', crypt('Cand@1234', gen_salt('bf', 10)), 'David Chang', v_alice_id,
          'pkGRJj83jkSgKnd0:XPHrP1lTsERlqjureEIfrg==:UZpm9WI/NbZH')
  RETURNING id INTO v_c1_id;

  INSERT INTO users (username, password_hash, display_name, created_by, encrypted_password)
  VALUES ('candidate_20260509_002', crypt('Cand@1234', gen_salt('bf', 10)), 'Emma Lin', v_alice_id,
          'pkGRJj83jkSgKnd0:XPHrP1lTsERlqjureEIfrg==:UZpm9WI/NbZH')
  RETURNING id INTO v_c2_id;

  INSERT INTO users (username, password_hash, display_name, created_by, encrypted_password)
  VALUES ('candidate_20260509_003', crypt('Cand@1234', gen_salt('bf', 10)), 'Frank Wu', v_bob_id,
          'pkGRJj83jkSgKnd0:XPHrP1lTsERlqjureEIfrg==:UZpm9WI/NbZH')
  RETURNING id INTO v_c3_id;

  INSERT INTO users (username, password_hash, display_name, created_by, encrypted_password)
  VALUES ('candidate_20260509_004', crypt('Cand@1234', gen_salt('bf', 10)), 'Grace Lee', v_alice_id,
          'pkGRJj83jkSgKnd0:XPHrP1lTsERlqjureEIfrg==:UZpm9WI/NbZH')
  RETURNING id INTO v_c4_id;

  INSERT INTO users (username, password_hash, display_name, created_by, encrypted_password)
  VALUES ('candidate_20260509_005', crypt('Cand@1234', gen_salt('bf', 10)), 'Henry Huang', v_bob_id,
          'pkGRJj83jkSgKnd0:XPHrP1lTsERlqjureEIfrg==:UZpm9WI/NbZH')
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
    
  -------------------------------------------------------------------------------
  -- 9. Container With Most Water (Medium)
  --
  -- [測資說明]
  -- 輸入格式：第一行為陣列長度 N，第二行為 N 個由空格分隔的非負整數（代表垂直線高度）。
  -- 輸出格式：一個整數，代表兩條線與 X 軸圍成的最大裝水容積。
  --
  -- 測資解析：
  -- * Case 1 (Public): LeetCode 經典範例，最大容積由 index 1 (高8) 與 index 8 (高7) 組成，距離為 7，容積 = min(8, 7) * 7 = 49。
  -- * Case 2 (Public): 邊界邊界測資（最小長度 N=2），高度均為 1，容積 = min(1, 1) * 1 = 1。
  -- * Case 3 (Hidden): 遞減數列測資 [4, 3, 2, 1]，最佳解為選擇前兩個 [4, 3]，距離 1，容積 = min(4, 3) * 1 = 3，或選擇 [4, 2] 容積為 4。
  -- * Case 4 (Hidden): 凹型/凸型過渡測資 [1, 2, 4, 3]，驗證雙指標（Two Pointers）向內收斂時的正確性。
  -------------------------------------------------------------------------------
  INSERT INTO problems (title, description_md, difficulty, time_limit_ms, memory_limit_mb, created_by)
  VALUES (
    'Container With Most Water',
    E'## Problem\n\nGiven $n$ non-negative integers $a_1, a_2, ..., a_n$ where each represents a point at coordinate $(i, a_i)$. Find two lines, which, together with the x-axis forms a container, such that the container contains the most water.\n\n**Input:** Line 1: `n` (number of elements); Line 2: space-separated integers representing heights.\n**Output:** An integer representing the maximum volume of water.',
    'medium', 1000, 256, v_carol_id
  ) RETURNING id INTO v_p9_id;

  INSERT INTO problem_language_limits (problem_id, language, time_multiplier, memory_multiplier)
  VALUES (v_p9_id, 'python3', 2.0, 2.0);

  INSERT INTO problem_testcases (problem_id, order_index, is_public, input_data, expected_output) VALUES
    (v_p9_id, 1, TRUE,  E'9\n1 8 6 2 5 4 8 3 7', '49'),
    (v_p9_id, 2, TRUE,  E'2\n1 1', '1'),
    (v_p9_id, 3, FALSE, E'4\n4 3 2 1', '4'),
    (v_p9_id, 4, FALSE, E'5\n1 2 4 3', '4');


  -------------------------------------------------------------------------------
  -- 10. Longest Substring Without Repeating Characters (Medium)
  --
  -- [測資說明]
  -- 輸入格式：第一行為一個字串 s（長度可能為 0，可能包含重複字母）。
  -- 輸出格式：一個整數，代表不含重複字元的「最長連續子字串」長度。
  --
  -- 測資解析：
  -- * Case 1 (Public): 標準交錯重複測資 "abcabcbb"，最長不重複子字串為 "abc"、"bca" 或 "cab"，長度均為 3。
  -- * Case 2 (Public): 全重複單一字元測資 "bbbbb"，最長不重複長度僅能為 1。
  -- * Case 3 (Public): 字元重疊於中段的測資 "pwwkew"，最長為 "wke"，長度為 3（注意 "pwke" 不是子字串，它是子序列）。
  -- * Case 4 (Hidden): 邊界測資（空字串 ""），預期輸出為 0。驗證程式碼是否有做防禦性檢查。
  -- * Case 5 (Hidden): 完全不重複的純遞增字串 "abcdefg"，預期輸出為字串總長度 7。
  -------------------------------------------------------------------------------
  INSERT INTO problems (title, description_md, difficulty, time_limit_ms, memory_limit_mb, created_by)
  VALUES (
    'Longest Substring Without Repeating Characters',
    E'## Problem\n\nGiven a string `s`, find the length of the longest substring without repeating characters.\n\n**Input:** Line 1: The string `s` (could be empty).\n**Output:** An integer representing the maximum length.',
    'medium', 1000, 256, v_carol_id
  ) RETURNING id INTO v_p10_id;

  INSERT INTO problem_language_limits (problem_id, language, time_multiplier, memory_multiplier)
  VALUES (v_p10_id, 'python3', 2.0, 2.0);

  INSERT INTO problem_testcases (problem_id, order_index, is_public, input_data, expected_output) VALUES
    (v_p10_id, 1, TRUE,  E'abcabcbb', '3'),
    (v_p10_id, 2, TRUE,  E'bbbbb', '1'),
    (v_p10_id, 3, TRUE,  E'pwwkew', '3'),
    (v_p10_id, 4, FALSE, E'', '0'),
    (v_p10_id, 5, FALSE, E'abcdefg', '7');


  -------------------------------------------------------------------------------
  -- 11. Edit Distance (Hard)
  --
  -- [測資說明]
  -- 輸入格式：第一行為來源字串 word1，第二行為目標字串 word2。
  -- 輸出格式：一個整數，代表將 word1 轉換為 word2 所需的最少操作步數（插入、刪除、替換）。
  --
  -- 測資解析：
  -- * Case 1 (Public): 範例測資 "horse" -> "ros"，最少需要 3 步（h->r, 刪除 o, 刪除 e）。
  -- * Case 2 (Public): 較長字串的複雜 DP 轉換 "intention" -> "execution"，最少需要 5 步。
  -- * Case 3 (Hidden): 單一字元轉換為空字串 "a" -> ""，需要 1 步（刪除），驗證 DP 表邊界初始化。
  -- * Case 4 (Hidden): 字元完全不同且長度相異的轉換 "plasma" -> "altitude"，需要 6 步，考驗動態規劃狀態轉移。
  -------------------------------------------------------------------------------
  INSERT INTO problems (title, description_md, difficulty, time_limit_ms, memory_limit_mb, created_by)
  VALUES (
    'Edit Distance',
    E'## Problem\n\nGiven two strings `word1` and `word2`, return the minimum number of operations required to convert `word1` to `word2`. You have 3 operations permitted on a word: Insert, Delete, or Replace a character.\n\n**Input:** Line 1: `word1`; Line 2: `word2`\n**Output:** An integer representing the minimum edit distance.',
    'hard', 2000, 512, v_carol_id
  ) RETURNING id INTO v_p11_id;

  INSERT INTO problem_language_limits (problem_id, language, time_multiplier, memory_multiplier)
  VALUES (v_p11_id, 'python3', 2.0, 2.0);

  INSERT INTO problem_testcases (problem_id, order_index, is_public, input_data, expected_output) VALUES
    (v_p11_id, 1, TRUE,  E'horse\nros', '3'),
    (v_p11_id, 2, TRUE,  E'intention\nexecution', '5'),
    (v_p11_id, 3, FALSE, E'a\n', '1'),
    (v_p11_id, 4, FALSE, E'plasma\naltitude', '6');


  -------------------------------------------------------------------------------
  -- 12. Sliding Window Maximum (Hard)
  --
  -- [測資說明]
  -- 輸入格式：第一行為兩個由空格分隔的整數，分別為陣列長度 N 與視窗大小 K。
  --           第二行為 N 個由空格分隔的整數（包含負數）。
  -- 輸出格式：一列由空格分隔的整數，代表視窗由左往右滑動時，每個視窗內的最大值。
  --
  -- 測資解析：
  -- * Case 1 (Public): 經典範例，陣列包含正負號與起伏 [1, 3, -1, -3, 5, 3, 6, 7] 且 K=3，驗證單調佇列（Monotonic Queue）的維護。
  -- * Case 2 (Public): 最小極端邊界，N=1 且 K=1，預期輸出即為該元素本身。
  -- * Case 3 (Hidden): 完全單調遞減數列 [4, 3, 2, 1] 且 K=2，驗證當左側滑出視窗時，最大值能否正確遞減更新（輸出：4 3 2）。
  -- * Case 4 (Hidden): 包含多個重複最大值與大幅震盪的數列 [-7, -8, 7, 5, 7, 1] 且 K=3，考驗雙向佇列（Deque）剔除過期索引的嚴謹度。
  -------------------------------------------------------------------------------
  INSERT INTO problems (title, description_md, difficulty, time_limit_ms, memory_limit_mb, created_by)
  VALUES (
    'Sliding Window Maximum',
    E'## Problem\n\nYou are given an array of integers `nums`, there is a sliding window of size `k` which is moving from the very left of the array to the very right. You can only see the `k` numbers in the window. Each time the sliding window moves right by one position. Return the max sliding window.\n\n**Input:** Line 1: `n` (array size) and `k` (window size) separated by space; Line 2: space-separated integers.\n**Output:** Space-separated max integers for each window position.',
    'hard', 2000, 512, v_carol_id
  ) RETURNING id INTO v_p12_id;

  INSERT INTO problem_language_limits (problem_id, language, time_multiplier, memory_multiplier)
  VALUES (v_p12_id, 'python3', 2.5, 2.0);

  INSERT INTO problem_testcases (problem_id, order_index, is_public, input_data, expected_output) VALUES
    (v_p12_id, 1, TRUE,  E'8 3\n1 3 -1 -3 5 3 6 7', '3 3 5 5 6 7'),
    (v_p12_id, 2, TRUE,  E'1 1\n1', '1'),
    (v_p12_id, 3, FALSE, E'4 2\n4 3 2 1', '4 3 2'),
    (v_p12_id, 4, FALSE, E'6 3\n-7 -8 7 5 7 1', '7 7 7 7');


  -------------------------------------------------------------------------------
  -- 13. N-Queens (Hard)
  --
  -- [測資說明]
  -- 輸入格式：第一行為一個整數 N，代表棋盤大小為 N * N。
  -- 輸出格式：一個整數，代表在該棋盤上擺放 N 個互不攻擊的皇后，總共獨立存在幾種解法。
  --
  -- 測資解析：
  -- * Case 1 (Public): 標準的 4 皇后問題（4x4 棋盤），其擺放法的對稱解總數為 2。
  -- * Case 2 (Public): 邊界基礎解，1 皇后（1x1 棋盤），擺放方法數必為 1。
  -- * Case 3 (Hidden): 經典的 8 皇后問題，解的總數為 92。這題可以有效測試回溯法（Backtracking）在大量遞迴下的效能與剪枝是否正確。
  -- * Case 4 (Hidden): 5 皇后問題，總共有 10 種可能解。作為中等複雜度效能與正確性的夾擊驗證。
  -------------------------------------------------------------------------------
  INSERT INTO problems (title, description_md, difficulty, time_limit_ms, memory_limit_mb, created_by)
  VALUES (
    'N-Queens',
    E'## Problem\n\nThe n-queens puzzle is the problem of placing $n$ queens on an $n \times n$ chessboard such that no two queens attack each other. Given an integer $n$, return the number of distinct solutions.\n\n**Input:** Line 1: An integer `n`.\n**Output:** An integer representing the total number of distinct solutions.',
    'hard', 2000, 512, v_carol_id
  ) RETURNING id INTO v_p13_id;

  INSERT INTO problem_language_limits (problem_id, language, time_multiplier, memory_multiplier)
  VALUES (v_p13_id, 'python3', 2.0, 2.0);

  INSERT INTO problem_testcases (problem_id, order_index, is_public, input_data, expected_output) VALUES
    (v_p13_id, 1, TRUE,  E'4', '2'),
    (v_p13_id, 2, TRUE,  E'1', '1'),
    (v_p13_id, 3, FALSE, E'8', '92'),
    (v_p13_id, 4, FALSE, E'5', '10');

  -- ================================================================
  -- 3. EXAM SESSIONS
  -- ================================================================

  -- Session 1: David — not_started
  INSERT INTO exams (title, duration_minutes, created_by)
  VALUES ('Backend Screening - David', 90, v_alice_id)
  RETURNING id INTO v_e1_id;

  INSERT INTO exam_problems (exam_id, problem_id, order_index, score_weight) VALUES
    (v_e1_id, v_p1_id, 1, 30),
    (v_e1_id, v_p4_id, 2, 40),
    (v_e1_id, v_p7_id, 3, 30);

  INSERT INTO exam_sessions (exam_id, candidate_id, created_by, status, max_score)
  VALUES (v_e1_id, v_c1_id, v_alice_id, 'not_started', 100)
  RETURNING id INTO v_s1_id;

  INSERT INTO exam_session_problems (exam_session_id, problem_id, order_index, score_weight) VALUES
    (v_s1_id, v_p1_id, 1, 30),
    (v_s1_id, v_p4_id, 2, 40),
    (v_s1_id, v_p7_id, 3, 30);

  -- Session 2: Emma — in_progress (started 40 min ago, 90 min limit → 50 min left)
  INSERT INTO exams (title, duration_minutes, created_by)
  VALUES ('Backend Screening - Emma', 90, v_alice_id)
  RETURNING id INTO v_e2_id;

  INSERT INTO exam_problems (exam_id, problem_id, order_index, score_weight) VALUES
    (v_e2_id, v_p2_id, 1, 30),
    (v_e2_id, v_p5_id, 2, 30),
    (v_e2_id, v_p8_id, 3, 30);

  INSERT INTO exam_sessions (
    exam_id, candidate_id, created_by, status,
    actual_start_at, expires_at, max_score
  ) VALUES (
    v_e2_id, v_c2_id, v_alice_id, 'in_progress',
    NOW() - INTERVAL '40 minutes',
    NOW() - INTERVAL '40 minutes' + INTERVAL '90 minutes',
    90
  ) RETURNING id INTO v_s2_id;

  INSERT INTO exam_session_problems (exam_session_id, problem_id, order_index, score_weight) VALUES
    (v_s2_id, v_p2_id, 1, 30),
    (v_s2_id, v_p5_id, 2, 30),
    (v_s2_id, v_p8_id, 3, 30);

  -- Session 3: Frank — submitted (3h ago), total=30/100
  INSERT INTO exams (title, duration_minutes, created_by)
  VALUES ('Senior Backend Screening - Frank', 120, v_bob_id)
  RETURNING id INTO v_e3_id;

  INSERT INTO exam_problems (exam_id, problem_id, order_index, score_weight) VALUES
    (v_e3_id, v_p1_id, 1, 30),
    (v_e3_id, v_p4_id, 2, 40),
    (v_e3_id, v_p7_id, 3, 30);

  INSERT INTO exam_sessions (
    exam_id, candidate_id, created_by, status,
    actual_start_at, expires_at, max_score, created_at, updated_at
  ) VALUES (
    v_e3_id, v_c3_id, v_bob_id, 'submitted',
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
  INSERT INTO exams (title, duration_minutes, created_by)
  VALUES ('Frontend Fundamentals - Grace', 60, v_alice_id)
  RETURNING id INTO v_e4_id;

  INSERT INTO exam_problems (exam_id, problem_id, order_index, score_weight) VALUES
    (v_e4_id, v_p3_id, 1, 30),
    (v_e4_id, v_p6_id, 2, 30),
    (v_e4_id, v_p8_id, 3, 30);

  INSERT INTO exam_sessions (exam_id, candidate_id, created_by, status, max_score)
  VALUES (v_e4_id, v_c4_id, v_alice_id, 'cancelled', 90)
  RETURNING id INTO v_s4_id;

  INSERT INTO exam_session_problems (exam_session_id, problem_id, order_index, score_weight) VALUES
    (v_s4_id, v_p3_id, 1, 30),
    (v_s4_id, v_p6_id, 2, 30),
    (v_s4_id, v_p8_id, 3, 30);

  -- Session 5: Henry first exam — P2(AC,30)+P5(WA,0)+P6(AC,30) = 60/90
  INSERT INTO exams (title, duration_minutes, created_by)
  VALUES ('Backend Retake Pool A - Henry', 90, v_bob_id)
  RETURNING id INTO v_e5_id;

  INSERT INTO exam_problems (exam_id, problem_id, order_index, score_weight) VALUES
    (v_e5_id, v_p2_id, 1, 30),
    (v_e5_id, v_p5_id, 2, 30),
    (v_e5_id, v_p6_id, 3, 30);

  INSERT INTO exam_sessions (
    exam_id, candidate_id, created_by, status,
    actual_start_at, expires_at, max_score, created_at, updated_at
  ) VALUES (
    v_e5_id, v_c5_id, v_bob_id, 'submitted',
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
  INSERT INTO exams (title, duration_minutes, created_by)
  VALUES ('Backend Retake Pool B - Henry', 90, v_bob_id)
  RETURNING id INTO v_e6_id;

  INSERT INTO exam_problems (exam_id, problem_id, order_index, score_weight) VALUES
    (v_e6_id, v_p1_id, 1, 30),
    (v_e6_id, v_p4_id, 2, 40),
    (v_e6_id, v_p7_id, 3, 30);

  INSERT INTO exam_sessions (
    exam_id, candidate_id, created_by, status,
    actual_start_at, expires_at, max_score, created_at, updated_at
  ) VALUES (
    v_e6_id, v_c5_id, v_bob_id, 'submitted',
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
