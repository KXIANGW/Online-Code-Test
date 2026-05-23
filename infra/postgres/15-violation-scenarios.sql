-- 反作弊功能 Demo 資料：為特定考試場次插入違規紀錄
-- 對應 10-scenarios.sql 建立的場次，讓面試官視角可看到異常行為範例
--
-- Emma  (candidate_20260509_002) — 進行中場次：偵測到離開全螢幕與切換分頁
-- Frank (candidate_20260509_003) — 已提交場次：多次違規，貼入外部程式碼
-- Henry (candidate_20260509_005) — 第一場已提交場次：貼入程式碼後立即通過

DO $$
DECLARE
  v_emma_session_id  BIGINT;
  v_frank_session_id BIGINT;
  v_henry_session_id BIGINT;
BEGIN
  -- 取得 Emma 進行中的場次
  SELECT es.id INTO v_emma_session_id
  FROM exam_sessions es
  JOIN users u ON u.id = es.candidate_id
  WHERE u.username = 'candidate_20260509_002'
    AND es.status = 'in_progress'
  LIMIT 1;

  -- 取得 Frank 已提交的場次
  SELECT es.id INTO v_frank_session_id
  FROM exam_sessions es
  JOIN users u ON u.id = es.candidate_id
  WHERE u.username = 'candidate_20260509_003'
    AND es.status = 'submitted'
  LIMIT 1;

  -- 取得 Henry 第一場已提交的場次（total_score=60）
  SELECT es.id INTO v_henry_session_id
  FROM exam_sessions es
  JOIN users u ON u.id = es.candidate_id
  WHERE u.username = 'candidate_20260509_005'
    AND es.status = 'submitted'
  ORDER BY es.id
  LIMIT 1;

  -- Emma 的違規紀錄：開考後 5 分鐘離開全螢幕、8 分鐘後切換分頁
  IF v_emma_session_id IS NOT NULL THEN
    INSERT INTO exam_violations (session_id, type, detail, occurred_at) VALUES
      (v_emma_session_id, 'fullscreen_exit', NULL,
       NOW() - INTERVAL '35 minutes'),
      (v_emma_session_id, 'tab_switch', NULL,
       NOW() - INTERVAL '32 minutes');
  END IF;

  -- Frank 的違規紀錄：頻繁切換視窗、貼入大量程式碼（可能抄題解）
  IF v_frank_session_id IS NOT NULL THEN
    INSERT INTO exam_violations (session_id, type, detail, occurred_at) VALUES
      (v_frank_session_id, 'fullscreen_exit', NULL,
       NOW() - INTERVAL '2 hours 50 minutes'),
      (v_frank_session_id, 'window_blur', NULL,
       NOW() - INTERVAL '2 hours 48 minutes'),
      (v_frank_session_id, 'window_blur', NULL,
       NOW() - INTERVAL '2 hours 40 minutes'),
      (v_frank_session_id, 'paste', 'length:312',
       NOW() - INTERVAL '2 hours 35 minutes'),
      (v_frank_session_id, 'tab_switch', NULL,
       NOW() - INTERVAL '2 hours 20 minutes'),
      (v_frank_session_id, 'paste', 'length:87',
       NOW() - INTERVAL '2 hours 10 minutes'),
      (v_frank_session_id, 'copy', 'length:143',
       NOW() - INTERVAL '2 hours 5 minutes');
  END IF;

  -- Henry 的違規紀錄：一次貼入程式碼
  IF v_henry_session_id IS NOT NULL THEN
    INSERT INTO exam_violations (session_id, type, detail, occurred_at) VALUES
      (v_henry_session_id, 'paste', 'length:45',
       NOW() - INTERVAL '4 hours 30 minutes');
  END IF;
END $$;
