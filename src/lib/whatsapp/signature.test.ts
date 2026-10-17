import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWhatsAppSignature } from "./signature";

const secret = "test-secret";

function sign(body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

describe("verifyWhatsAppSignature", () => {
  it("accepts a valid signature", () => {
    expect(verifyWhatsAppSignature("hello", sign("hello"), secret)).toBe(true);
  });

  it("rejects a signature computed over different content", () => {
    expect(verifyWhatsAppSignature("hello", sign("goodbye"), secret)).toBe(false);
  });

  it("rejects a length mismatch without throwing (never 500)", () => {
    expect(() => verifyWhatsAppSignature("hello", "sha256=abcd", secret)).not.toThrow();
    expect(verifyWhatsAppSignature("hello", "sha256=abcd", secret)).toBe(false);
  });

  it("rejects a header missing the sha256= prefix", () => {
    const hex = createHmac("sha256", secret).update("hello").digest("hex");
    expect(verifyWhatsAppSignature("hello", hex, secret)).toBe(false);
  });

  it("rejects a non-hex digest", () => {
    expect(verifyWhatsAppSignature("hello", "sha256=zzzz", secret)).toBe(false);
  });
});
