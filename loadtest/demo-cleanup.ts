/**
 * loadtest/demo-cleanup.ts
 *
 * 安全清理「本次 demo 建立的」應試者帳號。
 *
 * 安全設計（為什麼不會誤刪先前的帳號）：
 *   - 只讀本機 manifest 檔，絕不使用 `candidate_*` 萬用字元掃全表：
 *       · loadtest/.demo-accounts.json   ← demo-malicious.ts 寫入（id + username），預設來源
 *       · loadtest/.session-tokens.json  ← seed.ts 寫入（candidateUsername），需 --include-loadtest
 *   - 一個帳號只有同時滿足以下兩條件才會被刪：
 *       (1) username 出現在上述 manifest（＝這次我們建立的）
 *       (2) 目前仍存在於 /users（未被刪除）
 *   - 額外護欄：跳過 superuser；username 不在 manifest 一律不刪。
 *   因此 6/3 等先前殘留帳號（不在 manifest 內）永遠不會進入刪除清單。
 *   ⚠ .session-tokens.json 可能是先前本地壓測殘留，故預設不納入；要清 seed.ts
 *     建立的帳號時，請明確加 --include-loadtest（並確認該檔是本次 run 產生的）。
 *
 * 用法：
 *   cd loadtest && npx tsx demo-cleanup.ts                       # dry-run（只看 Demo A 帳號）
 *   cd loadtest && npx tsx demo-cleanup.ts --confirm             # 真的刪除 Demo A 帳號
 *   cd loadtest && npx tsx demo-cleanup.ts --include-loadtest    # dry-run（含 seed.ts 帳號）
 *   cd loadtest && npx tsx demo-cleanup.ts --include-loadtest --confirm
 *
 * 生產環境（用 root 這個 superuser 來刪）：
 *   BASE_URL=https://ikmlab.cs.nthu.edu.tw/online_code_test/api \
 *   ADMIN_USERNAME=root ADMIN_PASSWORD='Root@1234' \
 *   npx tsx demo-cleanup.ts --confirm
 *
 * 注意：DELETE 為軟刪除（設定 deletedAt），帳號列表會看不到，但資料列仍在 DB。
 *       要物理清除需在 server 端進 postgres 處理（這台電腦無生產 DB 連線）。
 */
import fs from "node:fs/promises";
import path from "node:path";

type Json = Record<string, unknown>;

const BASE_URL = process.env["BASE_URL"] ?? "http://localhost:3000/api";
const ADMIN_USERNAME = process.env["ADMIN_USERNAME"] ?? process.env["INTERVIEWER_USERNAME"] ?? "root";
const ADMIN_PASSWORD = process.env["ADMIN_PASSWORD"] ?? process.env["INTERVIEWER_PASSWORD"] ?? "Root@1234";
const CONFIRM = process.argv.includes("--confirm") || process.env["APPLY"] === "true";
const INCLUDE_LOADTEST = process.argv.includes("--include-loadtest");

const DEMO_MANIFEST = path.resolve(__dirname, ".demo-accounts.json");
const SESSION_TOKENS = path.resolve(__dirname, ".session-tokens.json");

async function http<T = Json>(
  method: string,
  pathSuffix: string,
  token?: string,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${pathSuffix}`, { method, headers });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${method} ${pathSuffix} -> ${text}`);
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Union of usernames we created this run, gathered from the local manifests only. */
async function manifestUsernames(): Promise<Set<string>> {
  const usernames = new Set<string>();

  const demo = await readJson<{ username: string }[]>(DEMO_MANIFEST);
  for (const e of demo ?? []) if (e.username) usernames.add(e.username);

  if (INCLUDE_LOADTEST) {
    const tokens = await readJson<{ candidateUsername: string }[]>(SESSION_TOKENS);
    for (const e of tokens ?? []) if (e.candidateUsername) usernames.add(e.candidateUsername);
    console.log(`[cleanup] --include-loadtest：已納入 ${SESSION_TOKENS}`);
  }

  return usernames;
}

async function main(): Promise<void> {
  console.log(`[cleanup] BASE_URL=${BASE_URL} mode=${CONFIRM ? "CONFIRM (will delete)" : "DRY-RUN"}`);

  const ours = await manifestUsernames();
  if (ours.size === 0) {
    console.log("[cleanup] manifest 為空（找不到 .demo-accounts.json / .session-tokens.json）。沒有東西可清理。");
    return;
  }
  console.log(`[cleanup] manifest 內本次建立的帳號數：${ours.size}`);

  const token = await login();
  const users = await http<{ id: number; username: string; isSuperuser?: boolean }[]>("GET", "/users", token);
  const existing = new Map(users.map((u) => [u.username, u]));

  // target = (in our manifest) ∩ (currently exists) ∩ (not superuser)
  const targets: { id: number; username: string }[] = [];
  const alreadyGone: string[] = [];
  for (const username of ours) {
    const u = existing.get(username);
    if (!u) {
      alreadyGone.push(username);
      continue;
    }
    if (u.isSuperuser) {
      console.log(`[cleanup] 跳過 superuser：${username}`);
      continue;
    }
    targets.push({ id: u.id, username: u.username });
  }

  if (alreadyGone.length) {
    console.log(`[cleanup] manifest 中已不存在（先前已刪 / 未建成功），略過 ${alreadyGone.length} 個。`);
  }

  if (targets.length === 0) {
    console.log("[cleanup] 沒有需要刪除的存活帳號。");
    return;
  }

  console.log(`\n[cleanup] 將${CONFIRM ? "" : "（dry-run，不會真的）"}刪除以下 ${targets.length} 個帳號：`);
  console.table(targets);

  if (!CONFIRM) {
    console.log("\n[cleanup] 這是 dry-run。確認無誤後加 --confirm 才會真的刪除。");
    return;
  }

  let ok = 0;
  const failed: { username: string; error: string }[] = [];
  for (const t of targets) {
    try {
      await http("DELETE", `/users/${t.id}`, token);
      ok += 1;
      console.log(`[cleanup] deleted ${t.username} (id=${t.id})`);
    } catch (err) {
      failed.push({ username: t.username, error: String(err) });
    }
  }

  // prune the demo manifest so re-runs stay idempotent
  const demo = (await readJson<{ id: number; username: string }[]>(DEMO_MANIFEST)) ?? [];
  const deletedUsernames = new Set(targets.map((t) => t.username));
  const remaining = demo.filter((e) => !deletedUsernames.has(e.username) || failed.some((f) => f.username === e.username));
  await fs.writeFile(DEMO_MANIFEST, JSON.stringify(remaining, null, 2), "utf8");

  console.log(`\n[cleanup] 完成：刪除 ${ok} 個，失敗 ${failed.length} 個。`);
  if (failed.length) console.table(failed);
  console.log("[cleanup] 提醒：DELETE 為軟刪除；提交/考場等資料列仍留在 DB，需 server 端進 postgres 才能物理清除。");
}

async function login(): Promise<string> {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed (${res.status}) as ${ADMIN_USERNAME}`);
  return ((await res.json()) as { token: string }).token;
}

main().catch((err) => {
  console.error("[cleanup] failed:", err);
  process.exit(1);
});
