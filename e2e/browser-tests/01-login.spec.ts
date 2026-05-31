import { test, expect } from "@playwright/test";
import { loginAs, logout } from "./helpers/auth.js";

const FRONTEND_URL = process.env["FRONTEND_URL"] ?? "http://localhost:5173";

test.describe("Login page", () => {
  test("shows login form on /login", async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/login`);
    await expect(page.locator("#username")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test("wrong password shows error alert", async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/login`);
    await page.fill("#username", "alice");
    await page.fill("#password", "wrongpassword");
    await page.click('button[type="submit"]');
    await expect(page.locator('[role="alert"]')).toBeVisible({
      timeout: 5000,
    });
  });

  test("alice logs in as interviewer and lands on /interviewer", async ({
    page,
  }) => {
    await loginAs(page, "alice", "Test@1234");
    await expect(page).toHaveURL(/\/interviewer/);
    await expect(
      page.locator('a:has-text("Online Code Test")'),
    ).toBeVisible();
  });

  test("root logs in as admin and lands on /admin", async ({ page }) => {
    await loginAs(page, "root", "Root@1234");
    await expect(page).toHaveURL(/\/admin/);
  });

  test("logout returns to /login", async ({ page }) => {
    await loginAs(page, "alice", "Test@1234");
    await logout(page);
    await expect(page).toHaveURL(/\/login/);
  });

  test("unauthenticated access to /interviewer redirects to /login", async ({
    page,
  }) => {
    await page.goto(`${FRONTEND_URL}/interviewer`);
    await expect(page).toHaveURL(/\/login/);
  });
});
