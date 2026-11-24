import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { whatsappTokenEncryptionKey } from "./config";

function encryptionKey(value = whatsappTokenEncryptionKey()) {
  const key = Buffer.from(value ?? "", "base64");
  if (key.length !== 32) throw new Error("whatsapp_invalid_encryption_key");
  return key;
}

export function encryptWhatsAppSecret(value: string, schoolId: string, key?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(key), iv);
  cipher.setAAD(Buffer.from(schoolId));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64")}`;
}

export function decryptWhatsAppSecret(value: string, schoolId: string, key?: string): string {
  if (!value.startsWith("v1:")) throw new Error("whatsapp_unknown_encryption_version");
  const bytes = Buffer.from(value.slice(3), "base64");
  if (bytes.length < 28) throw new Error("whatsapp_invalid_ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(key), bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(schoolId));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
}
