import { describe, it, expect } from "vitest";
import { api, login } from "../helpers/api.js";

const TS = Date.now().toString().slice(-8);

describe("Authentication", () => {
  it("login with valid credentials returns JWT", async () => {
    const token = await login("root", "Root@1234");
    const parts = token.split(".");
    expect(parts).toHaveLength(3);
  });

  it("login with wrong password returns 401", async () => {
    await expect(
      api(
        "POST",
        "/auth/login",
        { username: "root", password: "wrong" },
        undefined,
        401,
      ),
    ).resolves.toBeDefined();
  });

  it("login with non-existent user returns 401", async () => {
    await expect(
      api(
        "POST",
        "/auth/login",
        { username: `nouser_${TS}`, password: "anything" },
        undefined,
        401,
      ),
    ).resolves.toBeDefined();
  });

  it("protected endpoint without token returns 401", async () => {
    await expect(
      api("GET", "/users", undefined, undefined, 401),
    ).resolves.toBeDefined();
  });

  it("protected endpoint with malformed token returns 401", async () => {
    await expect(
      api("GET", "/users", undefined, "bad.token.here", 401),
    ).resolves.toBeDefined();
  });

  it("protected endpoint with valid token returns 200", async () => {
    const token = await login("root", "Root@1234");
    const users = await api<unknown[]>("GET", "/users", undefined, token, 200);
    expect(Array.isArray(users)).toBe(true);
  });
});
