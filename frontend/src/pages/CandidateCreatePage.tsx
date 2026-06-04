import { useState } from "react";
import { Link } from "react-router-dom";
import { NavBar } from "../components/NavBar";
import { createUser, createUsersBatch } from "../api/client";
import { useInterviewerStore } from "../stores/interviewerStore";
import type { CreateUserRequest, CreateUserResponse } from "../types";

type Mode = "single" | "batch";

interface CreatedAccount {
  username: string;
  displayName: string | null;
  password: string;
}

function generatePassword(length = 12) {
  const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+";
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
  const [batchCount, setBatchCount] = useState(10);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);

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
        displayName: singleForm.displayName ? singleForm.displayName : undefined,
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

  async function handleBatchSubmit() {
    if (!Number.isInteger(batchCount) || batchCount < 1) {
      setBatchError("建立數量至少為 1");
      return;
    }

    setBatchSubmitting(true);
    setBatchError(null);
    try {
      const created = await createUsersBatch(batchCount);
      setCandidates([]); // Invalidate store
      setResults(
        created.map((acc) => ({
          username: acc.username,
          displayName: null,
          password: acc.password,
        })),
      );
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || "建立失敗";
      setBatchError(msg);
    } finally {
      setBatchSubmitting(false);
    }
  }

  // ── Result panel ──────────────────────────────────────────────────────────

  if (results !== null) {
    return (
      <div className="min-h-screen bg-slate-50">
        <NavBar homeHref="/interviewer" />
        <main className="max-w-2xl mx-auto px-4 py-8">
          <h1 className="text-xl font-semibold text-slate-800 mb-6">建立結果</h1>

          {results.length > 0 && (
            <section className="mb-6">
              <h2 className="text-sm font-semibold text-green-700 mb-3">
                ✓ 成功建立 {results.length} 個帳號
              </h2>
              <div className="space-y-2">
                {results.map((acc) => (
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
                setSingleForm({
                  username: "",
                  displayName: "",
                  password: generatePassword(),
                  roleNames: ["candidate"],
                });
                setBatchCount(10);
                setBatchError(null);
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
              <label
                htmlFor="single-username"
                className="block text-xs font-semibold text-slate-500 mb-1"
              >
                帳號 (Username) *
              </label>
              <input
                id="single-username"
                type="text"
                aria-label="帳號"
                value={singleForm.username}
                onChange={(e) => setSingleForm({ ...singleForm, username: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="single-display-name"
                className="block text-xs font-semibold text-slate-500 mb-1"
              >
                顯示名稱 (Display Name)
              </label>
              <input
                id="single-display-name"
                type="text"
                value={singleForm.displayName}
                onChange={(e) => setSingleForm({ ...singleForm, displayName: e.target.value })}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="single-password"
                className="block text-xs font-semibold text-slate-500 mb-1"
              >
                密碼 *
              </label>
              <div className="flex gap-2">
                <input
                  id="single-password"
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
          <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
            <div>
              <label
                htmlFor="batch-count"
                className="block text-xs font-semibold text-slate-500 mb-1"
              >
                建立數量
              </label>
              <input
                id="batch-count"
                type="number"
                aria-label="建立數量"
                min={1}
                max={100}
                value={batchCount}
                onChange={(e) => setBatchCount(Number(e.target.value))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            {batchError && <p className="text-xs text-red-500">{batchError}</p>}
            <button
              type="button"
              onClick={handleBatchSubmit}
              disabled={batchSubmitting || batchCount < 1}
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
