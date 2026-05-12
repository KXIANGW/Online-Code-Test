/**
 * jwt.ts / authStore — decodeJwt unit tests + token-contamination bug docs
 *
 * Root cause of the reported issue
 * ─────────────────────────────────
 * authStore initializes isSuperuser/permissions by calling decodeJwt() on the
 * token stored in localStorage at module load time.  All browser tabs share the
 * same localStorage origin, so a login in Tab B overwrites the token that Tab A
 * (already logged in as a different user) will read on its next page refresh.
 *
 * Reproduction:
 *   1. Tab A: alice (exam:manage) logs in  → localStorage.oct_token = alice_token
 *   2. Tab B: candidate logs in            → localStorage.oct_token = cand_token  ← OVERWRITES
 *   3. Tab A refreshes                     → authStore reads cand_token
 *   4. decodeJwt returns { permissions: ["exam:take"] }
 *   5. RoleRedirect routes alice to /dashboard instead of /interviewer ← data lost
 */

import { describe, it, expect } from "vitest";
import { decodeJwt } from "../utils/jwt";

function makeToken(payload: object): string {
  const header = btoa(JSON.stringify({ alg: "HS256" }));
  const body   = btoa(JSON.stringify(payload));
  return `${header}.${body}.sig`;
}

describe("decodeJwt()", () => {
  // ── Baseline correctness ────────────────────────────────────────────────────

  it("returns isSuperuser=true from token payload", () => {
    const token = makeToken({ sub: 0, isSuperuser: true, permissions: [] });
    expect(decodeJwt(token).isSuperuser).toBe(true);
  });

  it("returns exam:manage permission for interviewer token", () => {
    const token = makeToken({ sub: 2, isSuperuser: false, permissions: ["exam:manage"] });
    const { isSuperuser, permissions } = decodeJwt(token);
    expect(isSuperuser).toBe(false);
    expect(permissions).toContain("exam:manage");
  });

  it("returns exam:take permission for candidate token", () => {
    const token = makeToken({ sub: 1, isSuperuser: false, permissions: ["exam:take"] });
    expect(decodeJwt(token).permissions).toContain("exam:take");
  });

  it("returns empty permissions when payload has no permissions field", () => {
    const token = makeToken({ sub: 99 });
    const { isSuperuser, permissions } = decodeJwt(token);
    expect(isSuperuser).toBe(false);
    expect(permissions).toEqual([]);
  });

  // ── Boundary: malformed tokens ──────────────────────────────────────────────

  it("returns safe defaults for a completely invalid token string", () => {
    const { isSuperuser, permissions } = decodeJwt("not-a-jwt");
    expect(isSuperuser).toBe(false);
    expect(permissions).toEqual([]);
  });

  it("returns safe defaults when the payload segment is invalid base64", () => {
    const { isSuperuser, permissions } = decodeJwt("header.!!!.sig");
    expect(isSuperuser).toBe(false);
    expect(permissions).toEqual([]);
  });

  it("returns safe defaults when the payload is valid base64 but not JSON", () => {
    const badBody = btoa("not json {{");
    const { isSuperuser, permissions } = decodeJwt(`hdr.${badBody}.sig`);
    expect(isSuperuser).toBe(false);
    expect(permissions).toEqual([]);
  });

  it("coerces a non-array permissions field to an empty array", () => {
    const token = makeToken({ permissions: "exam:manage" }); // string, not array
    expect(decodeJwt(token).permissions).toEqual([]);
  });

  // ── BUG DOCUMENTATION ───────────────────────────────────────────────────────
  //
  // The two tests below reproduce the contamination scenario at the decodeJwt
  // level.  decodeJwt itself is correct — it decodes whatever token it receives.
  // The bug is one layer up: authStore reads from localStorage at module-init
  // time, so ANY token there (even one written by another user in another tab)
  // determines the session's permissions for the entire page lifetime.
  //
  // Fix: replace localStorage with sessionStorage for oct_token so each tab
  // keeps its own isolated token and cross-tab contamination is impossible.

  it("[BUG] decoding the candidate token yields exam:take — not alice's exam:manage", () => {
    // This is what authStore decodes when another tab logged in as candidate,
    // overwriting alice's oct_token in localStorage.
    const candidateToken = makeToken({
      sub: 1,
      isSuperuser: false,
      permissions: ["exam:take"],
    });

    const { permissions } = decodeJwt(candidateToken);

    // alice needs exam:manage to reach /interviewer; she gets exam:take instead.
    expect(permissions).not.toContain("exam:manage");
    expect(permissions).toContain("exam:take");
    // → RoleRedirect routes alice to /dashboard: her interviewer view is "lost".
  });

  it("[BUG] a root token in localStorage grants superuser to ANY tab that refreshes", () => {
    // If a root tab logs in after alice, every other tab that refreshes reads
    // the root token and becomes isSuperuser — privilege escalation via shared storage.
    const rootToken = makeToken({ sub: 0, isSuperuser: true, permissions: [] });
    const { isSuperuser } = decodeJwt(rootToken);
    expect(isSuperuser).toBe(true);
  });
});
