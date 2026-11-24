import { randomBytes } from "node:crypto";
import { expect, it, vi } from "vitest";
import { decryptWhatsAppSecret, encryptWhatsAppSecret } from "./encryption";

vi.mock("server-only", () => ({}));
const key = randomBytes(32).toString("base64");

it("round-trips versioned, randomly nonced AES-GCM ciphertext", () => {
  const encrypted = encryptWhatsAppSecret("business-token", "school-a", key);
  expect(encrypted).toMatch(/^v1:/);
  expect(encrypted).not.toContain("business-token");
  expect(decryptWhatsAppSecret(encrypted, "school-a", key)).toBe("business-token");
  expect(encryptWhatsAppSecret("business-token", "school-a", key)).not.toBe(encrypted);
});

it("fails authentication for another school, key, or tampered ciphertext", () => {
  const encrypted = encryptWhatsAppSecret("123456", "school-a", key);
  expect(() => decryptWhatsAppSecret(encrypted, "school-b", key)).toThrow();
  expect(() =>
    decryptWhatsAppSecret(encrypted, "school-a", randomBytes(32).toString("base64")),
  ).toThrow();
  const bytes = Buffer.from(encrypted.slice(3), "base64");
  bytes[28] = bytes[28]! ^ 1;
  expect(() => decryptWhatsAppSecret(`v1:${bytes.toString("base64")}`, "school-a", key)).toThrow();
});

it("rejects invalid keys and unsupported versions", () => {
  expect(() => encryptWhatsAppSecret("secret", "school", "bad")).toThrow(
    "whatsapp_invalid_encryption_key",
  );
  expect(() => decryptWhatsAppSecret("v2:abc", "school", key)).toThrow(
    "whatsapp_unknown_encryption_version",
  );
});
