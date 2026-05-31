import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers/auth.js";

const FRONTEND_URL = process.env["FRONTEND_URL"] ?? "http://localhost:5173";

test.describe("Interviewer dashboard", () => {
  test("alice logs in and sees interviewer dashboard with navigation", async ({
    page,
  }) => {
    await loginAs(page, "alice", "Test@1234");
    await expect(page).toHaveURL(/\/interviewer/);

    await expect(
      page.locator('a:has-text("Online Code Test")'),
    ).toBeVisible();
    await expect(page.locator('a:has-text("考試管理")')).toBeVisible();
  });

  test("interviewer can navigate to create candidate page", async ({
    page,
  }) => {
    await loginAs(page, "alice", "Test@1234");
    await page.goto(`${FRONTEND_URL}/interviewer/candidates/new`);
    await expect(page).not.toHaveURL(/\/login/);
  });

  test("interviewer can navigate to create template page", async ({
    page,
  }) => {
    await loginAs(page, "alice", "Test@1234");
    await page.goto(`${FRONTEND_URL}/interviewer/templates/new`);
    await expect(page).not.toHaveURL(/\/login/);
  });
});
