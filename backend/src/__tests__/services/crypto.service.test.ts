import { describe, it, expect } from "vitest";
import { encryptPassword, decryptPassword } from "../../services/crypto.service";

describe("crypto.service", () => {
  // ── encryptPassword ───────────────────────────────────────────────────────

  describe("encryptPassword", () => {
    it("returns a three-part colon-delimited base64 string (iv:tag:ciphertext)", () => {
      // given / when
      const result = encryptPassword("Secret@1234");

      // expect
      const parts = result.split(":");
      expect(parts).toHaveLength(3);
      // each part must be non-empty base64
      for (const part of parts) {
        expect(part.length).toBeGreaterThan(0);
        expect(() => Buffer.from(part, "base64")).not.toThrow();
      }
    });

    it("produces a different ciphertext on each call (random IV)", () => {
      // given
      const plaintext = "Secret@1234";

      // when
      const first = encryptPassword(plaintext);
      const second = encryptPassword(plaintext);

      // expect: different IV → different output
      expect(first).not.toBe(second);
    });
  });

  // ── decryptPassword ───────────────────────────────────────────────────────

  describe("decryptPassword", () => {
    it("round-trip: decryptPassword(encryptPassword(p)) === p", () => {
      // given
      const plaintext = "Hunter2!@#longPass";

      // when
      const decrypted = decryptPassword(encryptPassword(plaintext));

      // expect
      expect(decrypted).toBe(plaintext);
    });

    it("preserves special characters and unicode in the round-trip", () => {
      // given
      const plaintext = "P@$$w0rd!面試者123";

      // when / expect
      expect(decryptPassword(encryptPassword(plaintext))).toBe(plaintext);
    });

    it("throws 'Invalid encrypted password format' when payload has fewer than 3 parts", () => {
      // given: only two colon-separated segments
      const malformed = "only:two";

      // when / expect
      expect(() => decryptPassword(malformed)).toThrow("Invalid encrypted password format");
    });

    it("throws when the ciphertext is tampered (GCM auth tag mismatch)", () => {
      // given: valid ciphertext with a flipped byte in the encrypted section
      const encrypted = encryptPassword("original");
      const [iv, tag, enc] = encrypted.split(":") as [string, string, string];
      const corrupted = Buffer.from(enc, "base64");
      corrupted.writeUInt8(corrupted.readUInt8(0) ^ 0xff, 0);
      const tampered = [iv, tag, corrupted.toString("base64")].join(":");

      // when / expect: GCM integrity check fails
      expect(() => decryptPassword(tampered)).toThrow();
    });

    it("throws when the auth tag is tampered", () => {
      // given: valid payload with a flipped byte in the auth tag section
      const encrypted = encryptPassword("original");
      const [iv, tag, enc] = encrypted.split(":") as [string, string, string];
      const corruptedTag = Buffer.from(tag, "base64");
      corruptedTag.writeUInt8(corruptedTag.readUInt8(0) ^ 0xff, 0);
      const tampered = [iv, corruptedTag.toString("base64"), enc].join(":");

      // when / expect
      expect(() => decryptPassword(tampered)).toThrow();
    });
  });
});
