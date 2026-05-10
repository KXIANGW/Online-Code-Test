import { useEffect, useState } from "react";
import {
  getHealth,
  getPing,
  type HealthResponse,
  type PingResponse,
} from "./api/client";

type Status = "loading" | "ok" | "error";

interface State<T> {
  status: Status;
  data?: T;
  error?: string;
}

const initial = <T,>(): State<T> => ({ status: "loading" });

export default function App() {
  const [health, setHealth] = useState<State<HealthResponse>>(initial);
  const [ping, setPing] = useState<State<PingResponse>>(initial);

  async function refresh() {
    setHealth(initial());
    setPing(initial());
    try {
      setHealth({ status: "ok", data: await getHealth() });
    } catch (err) {
      setHealth({ status: "error", error: (err as Error).message });
    }
    try {
      setPing({ status: "ok", data: await getPing() });
    } catch (err) {
      setPing({ status: "error", error: (err as Error).message });
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <main style={styles.page}>
      <h1 style={styles.h1}>Online Code Test — M1 skeleton</h1>
      <p style={styles.sub}>NTHU 1142 雲原生 HW2 / Team 12</p>

      <section style={styles.card}>
        <h2 style={styles.h2}>Backend health</h2>
        {health.status === "loading" && <p>Checking…</p>}
        {health.status === "ok" && health.data && (
          <ul style={styles.list}>
            <li>
              status:{" "}
              <strong style={statusColor(health.data.status)}>
                {health.data.status}
              </strong>
            </li>
            <li>db latency: {health.data.dbLatencyMs ?? "n/a"} ms</li>
            <li>uptime: {health.data.uptimeSec ?? "n/a"} s</li>
          </ul>
        )}
        {health.status === "error" && (
          <p style={styles.err}>backend unreachable: {health.error}</p>
        )}
      </section>

      <section style={styles.card}>
        <h2 style={styles.h2}>Ping</h2>
        {ping.status === "loading" && <p>Checking…</p>}
        {ping.status === "ok" && ping.data && (
          <ul style={styles.list}>
            <li>pong: {String(ping.data.pong)}</li>
            <li>server time: {ping.data.ts}</li>
          </ul>
        )}
        {ping.status === "error" && <p style={styles.err}>{ping.error}</p>}
      </section>

      <button type="button" onClick={refresh} style={styles.btn}>
        Refresh
      </button>
    </main>
  );
}

function statusColor(s: HealthResponse["status"]): React.CSSProperties {
  return { color: s === "ok" ? "#16a34a" : "#dc2626" };
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    maxWidth: 640,
    margin: "40px auto",
    padding: "0 16px",
    color: "#0f172a",
  },
  h1: { fontSize: 28, marginBottom: 4 },
  sub: { color: "#64748b", marginTop: 0 },
  card: {
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    padding: "16px 20px",
    marginTop: 20,
    background: "#f8fafc",
  },
  h2: { fontSize: 18, marginTop: 0 },
  list: { margin: 0, paddingLeft: 20, lineHeight: 1.7 },
  err: { color: "#dc2626", fontFamily: "monospace" },
  btn: {
    marginTop: 24,
    padding: "8px 18px",
    fontSize: 14,
    border: "1px solid #0f172a",
    borderRadius: 6,
    background: "white",
    cursor: "pointer",
  },
};
