import type { Pool } from "pg";

export async function waitFor(
  check: () => Promise<boolean>,
  timeoutMs = 120000,
  intervalMs = 250,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

export async function waitForSubmissionsDone(
  pool: Pool,
  ids: number[],
  timeoutMs = 120000,
): Promise<void> {
  await waitFor(async () => {
    const result = await pool.query<{ status: string }>(
      `SELECT status FROM submissions WHERE id = ANY($1::bigint[])`,
      [ids],
    );
    return (
      result.rows.length === ids.length &&
      result.rows.every((r) => r.status === "done")
    );
  }, timeoutMs);
}
