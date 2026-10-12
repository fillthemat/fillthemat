import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { schools } from "@/db/schema";
import { whatsappSystemUserToken } from "./config";

function encryptionKey(): Buffer {
  const key = process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY;
  if (!key || !/^[a-fA-F0-9]{64}$/.test(key)) {
    throw new Error("WHATSAPP_TOKEN_ENCRYPTION_KEY must be a 32-byte hex key");
  }
  return Buffer.from(key, "hex");
}

/** Server-only storage format; school identity authenticates the ciphertext. */
export function encryptWhatsAppToken(schoolId: string, token: string): string {
  if (!token.trim()) throw new Error("whatsapp_token_empty");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(schoolId));
  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("hex"),
    cipher.getAuthTag().toString("hex"),
    encrypted.toString("hex"),
  ].join(":");
}

/** Only schools without a customer token may fall back to the shared token. */
export function resolveWhatsAppToken(
  school: Pick<
    typeof schools.$inferSelect,
    "id" | "whatsappTokenEncrypted" | "whatsappTokenExpiresAt"
  >,
  now = new Date(),
): string | null {
  if (school.whatsappTokenEncrypted === null) return whatsappSystemUserToken();
  if (school.whatsappTokenExpiresAt && school.whatsappTokenExpiresAt <= now) {
    throw new Error("whatsapp_token_expired");
  }
  try {
    const [version, iv, tag, ciphertext, extra] =
      school.whatsappTokenEncrypted.split(":");
    if (
      version !== "v1" ||
      extra !== undefined ||
      !/^[a-f0-9]{24}$/.test(iv ?? "") ||
      !/^[a-f0-9]{32}$/.test(tag ?? "") ||
      !/^(?:[a-f0-9]{2})+$/.test(ciphertext ?? "")
    ) {
      throw new Error("invalid_ciphertext");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(iv, "hex"),
    );
    decipher.setAAD(Buffer.from(school.id));
    decipher.setAuthTag(Buffer.from(tag, "hex"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "hex")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Never propagate ciphertext, plaintext, or crypto/provider details to logs.
    throw new Error("whatsapp_token_unreadable");
  }
}
