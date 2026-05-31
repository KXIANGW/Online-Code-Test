import { test, expect } from "@playwright/test";
import { loginAs, typeInMonaco } from "./helpers/auth.js";
import { seedBrowserSession } from "./helpers/seed.js";

const TS = Date.now().toString().slice(-8);
const FRONTEND_URL = process.env["FRONTEND_URL"] ?? "http://localhost:5173";
const API_BASE = process.env["BASE_URL"] ?? "http://localhost:3000/api";

test.describe("Candidate exam flow", () => {
  test(
    "complete flow: login → start exam → submit AC code → see verdict in history tab",
    async ({ page }) => {
      // Timeout set globally to 120s in playwright.config.ts
      const { candidateUsername, candidatePassword } =
        await seedBrowserSession(`cf_${TS}`);

      await loginAs(page, candidateUsername, candidatePassword);
      await expect(page).toHaveURL(/\/candidate/);

      await expect(
        page.locator('button:has-text("開始考試")'),
      ).toBeVisible({ timeout: 10000 });

      await page.click('button:has-text("開始考試")');
      await expect(page.locator('[role="dialog"]')).toBeVisible({
        timeout: 5000,
      });

      await page.click('button:has-text("同意並開始考試")');
      await expect(page).toHaveURL(/\/exam\/\d+/, { timeout: 10000 });

      await expect(page.locator('[role="tab"]').first()).toBeVisible({
        timeout: 10000,
      });
      await expect(page.locator('[aria-label="倒數計時"]')).toBeVisible();
      await expect(page.locator("#language-select")).toBeVisible();

      await page.selectOption("#language-select", "python3");
      await typeInMonaco(page, "print(sum(map(int, input().split())))\n");

      await page.click('button:has-text("Submit")');
      await page.click('[role="tab"]:has-text("提交記錄")');

      await expect(page.locator("text=AC").first()).toBeVisible({
        timeout: 90000,
      });
    },
  );

  test(
    "candidate sees WA verdict for wrong answer",
    async ({ page }) => {
      const { candidateUsername, candidatePassword } =
        await seedBrowserSession(`wf_${TS}`);

      await loginAs(page, candidateUsername, candidatePassword);
      await page.click('button:has-text("開始考試")');
      await page.click('button:has-text("同意並開始考試")');
      await expect(page).toHaveURL(/\/exam\/\d+/, { timeout: 10000 });

      await page.selectOption("#language-select", "python3");
      await typeInMonaco(page, "print('wrong')\n");
      await page.click('button:has-text("Submit")');
      await page.click('[role="tab"]:has-text("提交記錄")');

      await expect(page.locator("text=WA").first()).toBeVisible({
        timeout: 90000,
      });
    },
  );

  test("result page shows score after submission", async ({ page }) => {
    const { candidateUsername, candidatePassword, sessionId } =
      await seedBrowserSession(`rp_${TS}`);

    const loginRes = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: candidateUsername,
        password: candidatePassword,
      }),
    });
    const { token } = (await loginRes.json()) as { token: string };

    await fetch(`${API_BASE}/exam-sessions/${sessionId}/start`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    const spsRes = await fetch(
      `${API_BASE}/exam-sessions/${sessionId}/problems`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const sps = (await spsRes.json()) as { id: number }[];

    await fetch(`${API_BASE}/exam-sessions/${sessionId}/submissions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        examSessionProblemId: sps[0]!.id,
        language: "python3",
        sourceCode: "print(sum(map(int, input().split())))\n",
        type: "formal",
      }),
    });

    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      const listRes = await fetch(
        `${API_BASE}/exam-sessions/${sessionId}/submissions`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const subs = (await listRes.json()) as { status: string }[];
      if (subs.length > 0 && subs[0]!.status === "done") break;
      await new Promise((r) => setTimeout(r, 1000));
    }

    await loginAs(page, candidateUsername, candidatePassword);
    await page.goto(`${FRONTEND_URL}/exam/${sessionId}/result`);

    await expect(page.locator("text=總分")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=100").first()).toBeVisible({
      timeout: 5000,
    });
  });
});
