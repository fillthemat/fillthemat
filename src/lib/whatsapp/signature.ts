import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify Meta's `X-Hub-Signature-256` header over the RAW request body.
 *
 * Returns `false` (never throws) on a length mismatch so the caller can answer
 * HTTP 401 instead of crashing with a 500.
 */
export function verifyWhatsAppSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
): boolean {
  if (!signatureHeader.startsWith("sha256=")) return false;
  const receivedHex = signatureHeader.slice("sha256=".length);
  if (!/^[0-9a-f]+$/i.test(receivedHex)) return false;

  const computed = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const computedBuf = Buffer.from(computed, "hex");
  const receivedBuf = Buffer.from(receivedHex, "hex");

  if (computedBuf.length !== receivedBuf.length) return false;
  return timingSafeEqual(computedBuf, receivedBuf);
}
