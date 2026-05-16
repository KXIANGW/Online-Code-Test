import { useEffect } from "react";
import type { JudgeResultMessage } from "../types";

export function useJudgeSocket(
  sessionId: number,
  onJudgeResult: (message: JudgeResultMessage) => void,
): void {
  useEffect(() => {
    const token = sessionStorage.getItem("oct_token");
    if (!token || !Number.isInteger(sessionId)) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(
      `${protocol}//${window.location.host}/api/ws?token=${encodeURIComponent(token)}`,
    );

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "subscribe", sessionId }));
    });

    socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(String(event.data)) as Partial<JudgeResultMessage>;
        if (message.type === "judge_result" && message.sessionId === sessionId) {
          onJudgeResult(message as JudgeResultMessage);
        }
      } catch {
        // Ignore malformed broker messages; the next valid result can still arrive.
      }
    });

    return () => socket.close();
  }, [onJudgeResult, sessionId]);
}
