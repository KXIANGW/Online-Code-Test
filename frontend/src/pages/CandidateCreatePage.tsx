import { useState } from "react";
import { Link } from "react-router-dom";
import { NavBar } from "../components/NavBar";
import { createUser } from "../api/client";
import { useInterviewerStore } from "../stores/interviewerStore";
import type { CreateUserRequest, CreateUserResponse } from "../types";

type Mode = "single" | "batch";

interface BatchRow {
  username: string;
  password: string;
}

interface CreatedAccount {
  username: string;
  displayName: string | null;
  password: string;
  error?: string;
}

function generatePassword(length = 12) {
  const charset =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+";
  const values = new Uint32Array(length);
  window.crypto.getRandomValues(values);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += charset.charAt(values[i] % charset.length);
  }
  return result;
}

export default function CandidateCreatePage() {
  const setCandidates = useInterviewerStore((s) => s.setCandidates);
  const [mode, setMode] = useState<Mode>("single");

  // Single mode state
  const [singleForm, setSingleForm] = useState<CreateUserRequest>({
    username: "",
    displayName: "",
    password: generatePassword(),
    roleNames: ["candidate"],
  });
  const [singleSubmitting, setSingleSubmitting] = useState(false);
  const [singleError, setSingleError] = useState<string | null>(null);

  // Batch mode state
  const [rows, setRows] = useState<BatchRow[]>([{ username: "", password: generatePassword() }]);
  const [batchSubmitting, setBatchSubmitting] = useState(false);

  // Results state (shown after submission)
  const [results, setResults] = useState<CreatedAccount[] | null>(null);

  // ── Single mode handlers ──────────────────────────────────────────────────

  async function handleSingleSubmit() {
    if (!singleForm.username.trim()) {
      setSingleError("請填寫帳號");
      return;
    }
    if (!singleForm.password) {
      setSingleError("請設定密碼");
      return;
    }
    setSingleSubmitting(true);
    setSingleError(null);
    try {
      const res: CreateUserResponse = await createUser({
        username: singleForm.username.trim(),
        displayName: singleForm.displayName || undefined,
        password: singleForm.password,
        roleNames: ["candidate"],
      });
      setCandidates([]); // Invalidate store
      setResults([
        {
          username: res.username,
          displayName: res.displayName,
          password: singleForm.password,
        },
      ]);
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || "建立失敗";
      setSingleError(msg);
    } finally {
      setSingleSubmitting(false);
    }
  }

  // ── Batch mode handlers ───────────────────────────────────────────────────

  function addRow() {
    setRows([...rows, { username: "", password: generatePassword() }]);
  }

  function removeRow(idx: number) {
    setRows(rows.filter((_, i) => i !== idx));
  }

  function updateRow(idx: number, field: keyof BatchRow, value: string) {
    setRows(rows.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  }

  function fillAllPasswords() {
    setRows(rows.map((r) => ({ ...r, password: r.password || generatePassword() })));
  }

  async function handleBatchSubmit() {
    const validRows = rows.filter((r) => r.username.trim());
    if (validRows.length === 0) {
      return;
    }
    setBatchSubmitting(true);
    const created: CreatedAccount[] = [];

    for (const row of validRows) {
      try {
        const res: CreateUserResponse = await createUser({
          username: row.username.trim(),
          password: row.password || generatePassword(),
          roleNames: ["candidate"],
        });
        created.push({
          username: res.username,
          displayName: res.displayName,
          password: row.password,
        });
      } catch (err: any) {
        const msg = err.response?.data?.message || err.message || "建立失敗";
        created.push({
          username: row.username.trim(),
          displayName: null,
          password: row.password,
          error: msg,
        });
      }
    }

    setBatchSubmitting(false);
    setCandidates([]); // Invalidate store
    setResults(created);
  }

  // ── Result panel ──────────────────────────────────────────────────────────

  if (results !== null) {
    const succeeded = results.filter((r) => !r.error);
    const failed = results.filter((r) => r.error);

    return (
      <div className="min-h-screen bg-slate-50">
        <NavBar homeHref="/interviewer" />
        <main className="max-w-2xl mx-auto px-4 py-8">
          <h1 className="text-xl font-semibold text-slate-800 mb-6">建立結果</h1>

          {succeeded.length > 0 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold text-green-700 mb-3">
                ✓ 成功建立 {succeeded.length} 個帳號
              </h2>
              <div className="space-y-2">
                {succeeded.map((acc) => (
                  <div
                    key={acc.username}
                    className="bg-white rounded-xl border border-slate-200 p-4 font-mono text-sm space-y-1"
                  >
                    <p>
                      <span className="text-slate-500">帳號：</span>
                      <span className="font-semibold text-slate-800">{acc.username}</span>
                      {acc.displayName && (
                        <span className="text-slate-500 ml-2">({acc.displayName})</span>
                      )}
                    </p>
                    <p>
                      <span className="text-slate-500">密碼：</span>
                      <span className="text-blue-600 select-all">{acc.password}</span>
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {failed.length > 0 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold text-red-600 mb-3">
                ✗ 建立失敗 {failed.length} 個帳號
              </h2>
              <div className="space-y-2">
                {failed.map((acc) => (
                  <div
                    key={acc.username}
                    className="bg-red-50 rounded-xl border border-red-200 p-4 text-sm"
                  >
                    <p className="font-semibold text-red-700">{acc.username}</p>
                    <p className="text-red-500 text-xs mt-1">{acc.error}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="flex gap-3">
            <Link
              to="/interviewer"
              className="px-4 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              返回考試管理
            </Link>
            <button
              onClick={() => {
                setResults(null);
                setSingleForm({ username: "", displayName: "", password: generatePassword(), roleNames: ["candidate"] });
                setRows([{ username: "", password: generatePassword() }]);
              }}
              className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700"
            >
              繼續建立帳號
            </button>
          </div>
        </main>
      </div>
    );
  }

  // ── Create form ───────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-50">
      <NavBar homeHref="/interviewer" />
      <main className="max-w-2xl mx-auto px-4 py-8">
        <Link
          to="/interviewer"
          className="text-sm text-slate-500 hover:text-slate-700 mb-6 flex items-center gap-1"
        >
          ← 返回考試管理
        </Link>

        <h1 className="text-xl font-semibold text-slate-800 mb-6">建立考生帳號</h1>

        {/* Mode toggle */}
        <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm mb-6 w-fit">
          {(["single", "batch"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-4 py-2 transition-colors ${
                mode === m ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {m === "single" ? "單一建立" : "批次建立"}
            </button>
          ))}
        </div>

        {mode === "single" ? (
          <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">
                帳號 (Username) *
              </label>
              <input
                type="text"
                aria-label="帳號"
                value={singleForm.username}
                onChange={(e) => setSingleForm({ ...singleForm, username: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">
                顯示名稱 (Display Name)
              </label>
              <input
                type="text"
                aria-label="顯示名稱"
                value={singleForm.displayName}
                onChange={(e) => setSingleForm({ ...singleForm, displayName: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">
                密碼 *
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  aria-label="密碼"
                  value={singleForm.password}
                  onChange={(e) => setSingleForm({ ...singleForm, password: e.target.value })}
                  className="flex-1 border rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none"
                />
                <button
                  type="button"
                  aria-label="自動產生密碼"
                  onClick={() => setSingleForm({ ...singleForm, password: generatePassword() })}
                  className="px-3 py-2 border border-slate-200 rounded-lg text-sm hover:bg-slate-50"
                >
                  自動產生
                </button>
              </div>
            </div>
            {singleError && <p className="text-xs text-red-500">{singleError}</p>}
            <button
              type="button"
              onClick={handleSingleSubmit}
              disabled={singleSubmitting}
              className="w-full px-4 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {singleSubmitting ? "建立中..." : "建立帳號"}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              {rows.map((row, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <input
                    type="text"
                    aria-label={`帳號 ${idx + 1}`}
                    placeholder="帳號"
                    value={row.username}
                    onChange={(e) => updateRow(idx, "username", e.target.value)}
                    className="flex-1 border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                  <input
                    type="text"
                    aria-label={`密碼 ${idx + 1}`}
                    placeholder="密碼"
                    value={row.password}
                    onChange={(e) => updateRow(idx, "password", e.target.value)}
                    className="flex-1 border rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                  <button
                    type="button"
                    aria-label={`刪除第 ${idx + 1} 行`}
                    onClick={() => removeRow(idx)}
                    className="text-slate-400 hover:text-red-500 p-1"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={addRow}
                className="text-sm text-blue-600 hover:text-blue-800 font-medium"
              >
                ＋ 新增一行
              </button>
              <button
                type="button"
                onClick={fillAllPasswords}
                className="text-sm text-slate-500 hover:text-slate-700"
              >
                全部自動產生密碼
              </button>
            </div>
            <button
              type="button"
              onClick={handleBatchSubmit}
              disabled={batchSubmitting || rows.every((r) => !r.username.trim())}
              className="w-full px-4 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {batchSubmitting ? "建立中..." : "批次建立帳號"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
