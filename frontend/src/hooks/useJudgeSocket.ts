import { useEffect } from "react";
import { apiBaseURL } from "../api/client";
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
      const normalizedApiBaseURL = apiBaseURL.endsWith("/") ? apiBaseURL.slice(0, -1) : apiBaseURL;
      const socketURL = new URL(normalizedApiBaseURL + "/ws", window.location.origin);
      socketURL.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socketURL.searchParams.set("token", token);
      socket = new WebSocket(socketURL.toString());

      socket.addEventListener("open", () => {
        socket?.send(JSON.stringify({ type: "subscribe", sessionId }));
        if (hasConnected) {
          const reconnectPromise = onReconnect?.();
          if (reconnectPromise) reconnectPromise.catch(() => {});
        }
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
