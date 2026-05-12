import { describe, it, expect } from "vitest";
import { decodeJwt } from "../utils/jwt";

function makeToken(payload: object): string {
  const header = btoa(JSON.stringify({ alg: "HS256" }));
  const body   = btoa(JSON.stringify(payload));
  return `${header}.${body}.sig`;
}

describe("decodeJwt()", () => {
  // ── Baseline correctness ──────────────────────────────────────────────────

  it("extracts isSuperuser=true from a superuser token", () => {
    // given
    const token = makeToken({ sub: 0, isSuperuser: true, permissions: [] });

    // when
    const result = decodeJwt(token);

    // expect
    expect(result.isSuperuser).toBe(true);
  });

  it("extracts exam:manage permission for an interviewer token", () => {
    // given
    const token = makeToken({ sub: 2, isSuperuser: false, permissions: ["exam:manage"] });

    // when
    const { isSuperuser, permissions } = decodeJwt(token);

    // expect
    expect(isSuperuser).toBe(false);
    expect(permissions).toContain("exam:manage");
  });

  it("extracts exam:take permission for a candidate token", () => {
    // given
    const token = makeToken({ sub: 1, isSuperuser: false, permissions: ["exam:take"] });

    // when
    const { permissions } = decodeJwt(token);

    // expect
    expect(permissions).toContain("exam:take");
  });

  it("returns isSuperuser=false and empty permissions when payload has no such fields", () => {
    // given
    const token = makeToken({ sub: 99 });

    // when
    const { isSuperuser, permissions } = decodeJwt(token);

    // expect
    expect(isSuperuser).toBe(false);
    expect(permissions).toEqual([]);
  });

  // ── Boundary: malformed tokens ─────────────────────────────────────────────

  it("returns safe defaults for a completely invalid token string", () => {
    // given
    const token = "not-a-jwt";

    // when
    const { isSuperuser, permissions } = decodeJwt(token);

    // expect
    expect(isSuperuser).toBe(false);
    expect(permissions).toEqual([]);
  });

  it("returns safe defaults when the payload segment is invalid base64", () => {
    // given
    const token = "header.!!!.sig";

    // when
    const { isSuperuser, permissions } = decodeJwt(token);

    // expect
    expect(isSuperuser).toBe(false);
    expect(permissions).toEqual([]);
  });

  it("returns safe defaults when the payload is valid base64 but not JSON", () => {
    // given
    const badBody = btoa("not json {{");
    const token = `hdr.${badBody}.sig`;

    // when
    const { isSuperuser, permissions } = decodeJwt(token);

    // expect
    expect(isSuperuser).toBe(false);
    expect(permissions).toEqual([]);
  });

  it("coerces a non-array permissions field to an empty array", () => {
    // given: malformed payload where permissions is a string instead of an array
    const token = makeToken({ permissions: "exam:manage" });

    // when
    const { permissions } = decodeJwt(token);

    // expect
    expect(permissions).toEqual([]);
  });
});
