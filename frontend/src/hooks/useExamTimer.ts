import { useEffect, useState } from "react";

export function formatTimeLeft(seconds: number): string {
  if (seconds <= 0) return "00:00:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

function calculateTimeLeft(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  return Math.max(
    0,
    Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000),
  );
}

export function useExamTimer(expiresAt: string | null): number | null {
  const [timeLeft, setTimeLeft] = useState<number | null>(() =>
    calculateTimeLeft(expiresAt),
  );

  useEffect(() => {
    setTimeLeft(calculateTimeLeft(expiresAt));
    if (!expiresAt) return;

    const interval = setInterval(() => {
      setTimeLeft(calculateTimeLeft(expiresAt));
    }, 1000);

    return () => clearInterval(interval);
  }, [expiresAt]);

  return timeLeft;
}
