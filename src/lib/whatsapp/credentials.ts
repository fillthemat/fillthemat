import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type SchoolSecretPurpose = "token" | "pin";
export type SchoolSecretResult =
  | { ok: true; secret: string }
  | { ok: false; code: "missing_secret" | "expired_secret" };

function encryptionKey(): Buffer {
  const key = process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY;
  if (!key || !/^[a-fA-F0-9]{64}$/.test(key)) {
    throw new Error("WHATSAPP_TOKEN_ENCRYPTION_KEY must be a 32-byte hex key");
  }
  return Buffer.from(key, "hex");
}

/** Server-only storage format; school identity authenticates the ciphertext. */
export function encryptSchoolSecret(
  schoolId: string,
  secret: string,
  purpose: SchoolSecretPurpose,
): string {
  if (!secret.trim()) throw new Error("school_secret_empty");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(`${schoolId}:${purpose}`));
  const encrypted = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("hex"),
    cipher.getAuthTag().toString("hex"),
    encrypted.toString("hex"),
  ].join(":");
}

/** School-bound credentials only; missing credentials never use shared access. */
export function resolveSchoolSecret(
  school: { id: string; encrypted: string | null; expiresAt: Date | null },
  purpose: SchoolSecretPurpose,
  now = new Date(),
): SchoolSecretResult {
  if (school.encrypted === null) return { ok: false, code: "missing_secret" };
  if (school.expiresAt && school.expiresAt <= now) {
    return { ok: false, code: "expired_secret" };
  }
  try {
    const [version, iv, tag, ciphertext, extra] = school.encrypted.split(":");
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
    decipher.setAAD(Buffer.from(`${school.id}:${purpose}`));
    decipher.setAuthTag(Buffer.from(tag, "hex"));
    return {
      ok: true,
      secret: Buffer.concat([
        decipher.update(Buffer.from(ciphertext, "hex")),
        decipher.final(),
      ]).toString("utf8"),
    };
  } catch {
    // Never propagate ciphertext, plaintext, or crypto/provider details to logs.
    throw new Error("school_secret_unreadable");
  }
}
