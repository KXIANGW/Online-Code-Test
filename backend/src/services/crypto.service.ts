import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { env } from "../env";

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  return Buffer.from(env.ENCRYPTION_SECRET, "hex");
}

/** Returns "base64(iv):base64(authTag):base64(ciphertext)". */
export function encryptPassword(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(":");
}

/** Reverses encryptPassword. Throws if the payload is tampered. */
export function decryptPassword(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted password format");
  const [ivB64, tagB64, encB64] = parts as [string, string, string];
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encB64, "base64")), decipher.final()]).toString(
    "utf8",
  );
}
