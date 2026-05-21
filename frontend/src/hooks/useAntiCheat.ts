import { useEffect, useRef, useCallback } from "react";
import { toast } from "react-hot-toast";
import { reportViolation } from "../api/client";
import type { ViolationType } from "../types";

interface UseAntiCheatOptions {
  sessionId: number;
  /** 僅在 in_progress 狀態下啟用偵測 */
  enabled: boolean;
}

interface UseAntiCheatReturn {
  /**
   * 傳給 Monaco Editor 的 onDidPaste 回呼
   * 在 ExamPage 的 onMount 中呼叫 editor.onDidPaste(handleEditorPaste)
   */
  handleEditorPaste: (pastedText: string) => void;
}

export function useAntiCheat({ sessionId, enabled }: UseAntiCheatOptions): UseAntiCheatReturn {
  // 用 ref 持有 enabled 與 sessionId，避免事件 listener 閉包捕捉過時值
  const enabledRef = useRef(enabled);
  const sessionIdRef = useRef(sessionId);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // 記錄上一次 window_blur 的時間，防止短時間內重複上報
  const lastBlurRef = useRef<number>(0);
  // 追蹤是否曾發生過 tab_switch，以便切回分頁時補顯 toast
  const hadTabSwitchRef = useRef(false);

  const report = useCallback(async (type: ViolationType, detail?: string) => {
    try {
      await reportViolation(sessionIdRef.current, {
        type,
        detail,
        occurredAt: new Date().toISOString(),
      });
    } catch {
      // 上報失敗不中斷考試，靜默忽略
    }
  }, []);

  // ── 全螢幕離開偵測 ─────────────────────────────────────────────────────────
  useEffect(() => {
    function handleFullscreenChange() {
      if (!enabledRef.current) return;
      if (!document.fullscreenElement) {
        toast.error("警告：你已離開全螢幕！此行為已記錄。", { duration: 6000 });
        void report("fullscreen_exit");
      }
    }
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [report]);

  // ── 切換分頁偵測 ───────────────────────────────────────────────────────────
  useEffect(() => {
    function handleVisibilityChange() {
      if (!enabledRef.current) return;
      if (document.visibilityState === "hidden") {
        hadTabSwitchRef.current = true;
        void report("tab_switch");
      } else if (document.visibilityState === "visible" && hadTabSwitchRef.current) {
        hadTabSwitchRef.current = false;
        toast.error("警告：偵測到切換分頁！此行為已記錄。", { duration: 6000 });
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [report]);

  // ── 視窗失焦偵測（切換至其他應用程式）────────────────────────────────────
  // 只在 tab 仍可見時上報，避免與切換分頁事件重複計算
  useEffect(() => {
    function handleBlur() {
      if (!enabledRef.current) return;
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      // 2 秒內不重複上報，防止 blur 短暫連發
      if (now - lastBlurRef.current < 2000) return;
      lastBlurRef.current = now;
      toast.error("警告：偵測到切換至其他視窗！此行為已記錄。", { duration: 6000 });
      void report("window_blur");
    }
    window.addEventListener("blur", handleBlur);
    return () => window.removeEventListener("blur", handleBlur);
  }, [report]);

  // ── 複製題目內容偵測 ───────────────────────────────────────────────────────
  // 靜默記錄（不彈 toast），僅供面試官事後查閱
  useEffect(() => {
    function handleCopy() {
      if (!enabledRef.current) return;
      const selection = window.getSelection()?.toString() ?? "";
      if (selection.length > 0) {
        void report("copy", `length:${selection.length}`);
      }
    }
    document.addEventListener("copy", handleCopy);
    return () => document.removeEventListener("copy", handleCopy);
  }, [report]);

  // ── Monaco 貼入程式碼偵測（由 ExamPage 透過 onMount 傳入） ────────────────
  const handleEditorPaste = useCallback(
    (pastedText: string) => {
      if (!enabledRef.current) return;
      toast.error("警告：偵測到貼入外部程式碼！此行為已記錄。", { duration: 5000 });
      void report("paste", `length:${pastedText.length}`);
    },
    [report],
  );

  return { handleEditorPaste };
}
