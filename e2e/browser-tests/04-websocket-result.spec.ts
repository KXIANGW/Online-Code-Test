import { test, expect, type WebSocket as PWWebSocket } from "@playwright/test";
import { loginAs, typeInMonaco } from "./helpers/auth.js";
import { seedBrowserSession } from "./helpers/seed.js";

const TS = Date.now().toString().slice(-8);

test.describe("WebSocket real-time judge result", () => {
  test(
    "verdict appears in history tab via WebSocket push (no page reload)",
    async ({ page }) => {
      const { candidateUsername, candidatePassword } =
        await seedBrowserSession(`ws_${TS}`);

      await loginAs(page, candidateUsername, candidatePassword);

      const wsConnectedPromise = page.waitForEvent("websocket", (ws: PWWebSocket) =>
        ws.url().includes("/api/ws"),
      );

      await page.click('button:has-text("開始考試")');
      await page.click('button:has-text("同意並開始考試")');
      await expect(page).toHaveURL(/\/exam\/\d+/, { timeout: 10000 });

      const ws = await wsConnectedPromise;
      expect(ws.url()).toContain("/api/ws");

      await page.selectOption("#language-select", "python3");
      await typeInMonaco(page, "print(sum(map(int, input().split())))\n");

      const wsResultPromise = ws.waitForEvent("framereceived", {
        predicate: (frame: { payload: string | Buffer }) => {
          try {
            const msg = JSON.parse(String(frame.payload)) as { type: string };
            return (
              msg.type === "judge_result" || msg.type === "submission_status"
            );
          } catch {
            return false;
          }
        },
        timeout: 90000,
      });

      await page.click('button:has-text("Submit")');

      const frame = await wsResultPromise;
      const msg = JSON.parse(String(frame.payload)) as { type: string };
      expect(["submission_status", "judge_result"]).toContain(msg.type);

      await page.click('[role="tab"]:has-text("提交記錄")');
      await expect(page.locator("text=AC").first()).toBeVisible({
        timeout: 90000,
      });
    },
  );
});
