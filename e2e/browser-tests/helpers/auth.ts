import type { Page } from "@playwright/test";

const FRONTEND_URL = process.env["FRONTEND_URL"] ?? "http://localhost:5173";

export async function loginAs(
  page: Page,
  username: string,
  password: string,
): Promise<void> {
  await page.goto(`${FRONTEND_URL}/login`);
  await page.fill("#username", username);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.includes("/login"), {
    timeout: 10000,
  });
}

export async function logout(page: Page): Promise<void> {
  await page.click('[aria-label="User menu"]');
  await page.click('button:has-text("Log out")');
  await page.waitForURL("**/login");
}

export async function typeInMonaco(page: Page, code: string): Promise<void> {
  // Monaco editor exposes a hidden textarea that Playwright can interact with
  const textarea = page.locator(".monaco-editor textarea").first();
  await textarea.click({ force: true });
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Delete");
  await page.keyboard.type(code, { delay: 20 });
}
