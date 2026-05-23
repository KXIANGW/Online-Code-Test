-- exam_violations: 紀錄考生在考試過程中的異常行為
-- 由前端即時偵測（全螢幕離開、切換分頁、視窗失焦、貼入程式碼、複製題目）並上報至後端儲存
-- 面試官可透過 GET /exam-sessions/:id/violations 查詢特定場次的完整違規紀錄

CREATE TYPE violation_type AS ENUM (
  'fullscreen_exit',  -- 考生主動離開全螢幕模式（按 Esc 或切換視窗導致退出）
  'tab_switch',       -- 切換至其他瀏覽器分頁（document.visibilityState → hidden）
  'window_blur',      -- 視窗失焦但分頁仍可見（例如 Alt+Tab 切至其他應用程式）
  'paste',            -- 在程式碼編輯器中貼入外部程式碼（Monaco onDidPaste 事件）
  'copy'              -- 複製題目描述內容（document copy 事件，可能用於搜尋）
);

CREATE TABLE IF NOT EXISTS exam_violations (
  id          BIGSERIAL    PRIMARY KEY,
  session_id  BIGINT       NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  type        violation_type NOT NULL,
  -- 附加說明，例如貼上字元數、複製字元數等，可供面試官評估嚴重性
  detail      TEXT,
  occurred_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 查詢特定場次的所有違規紀錄（面試官視角）
CREATE INDEX IF NOT EXISTS idx_exam_violations_session_id
  ON exam_violations(session_id, occurred_at);
