import { useEffect } from "react";
import type { JudgeSocketMessage } from "../types";

export function useJudgeSocket(
  sessionId: number,
  onMessage: (message: JudgeSocketMessage) => void,
  onReconnect?: () => void | Promise<void>,
): void {
  useEffect(() => {
    const token = sessionStorage.getItem("oct_token");
    if (!token || !Number.isInteger(sessionId)) return;

    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closedByEffect = false;
    let hasConnected = false;

    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(
        `${protocol}//${window.location.host}/api/ws?token=${encodeURIComponent(token)}`,
      );

      socket.addEventListener("open", () => {
        socket?.send(JSON.stringify({ type: "subscribe", sessionId }));
        if (hasConnected) void onReconnect?.();
        hasConnected = true;
      });

      socket.addEventListener("message", (event) => {
        try {
          const message = JSON.parse(String(event.data)) as Partial<JudgeSocketMessage>;
          if (
            (message.type === "judge_result" || message.type === "submission_status") &&
            message.sessionId === sessionId
          ) {
            onMessage(message as JudgeSocketMessage);
          }
        } catch {
          // Ignore malformed broker messages; the next valid result can still arrive.
        }
      });

      socket.addEventListener("close", () => {
        if (closedByEffect) return;
        reconnectTimer = setTimeout(connect, 1000);
      });
    };

    connect();

    return () => {
      closedByEffect = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [onMessage, onReconnect, sessionId]);
}
