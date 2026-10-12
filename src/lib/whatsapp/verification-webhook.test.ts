import { describe, expect, it } from "vitest";
import { verifyAgentPhoneRequest } from "./carrier-webhook";

describe("AgentPhone verification webhook", () => {
  it("verifies the exact timestamp and raw body with HMAC-SHA256", () => {
    // Independently generated OpenSSL HMAC vector for 1791806400.{}
    const input = {
      rawBody: "{}",
      timestamp: "1791806400",
      secret: "test-secret",
      signature:
        "sha256=85a1c4b33af95fe27c93ca9a33c936445c22f0c8ec7a26fc1aaf29cf086c1497",
      now: new Date("2026-10-12T12:00:00Z"),
    };
    expect(verifyAgentPhoneRequest(input)).toBe(true);
    expect(verifyAgentPhoneRequest({ ...input, rawBody: "{ }" })).toBe(false);
    expect(verifyAgentPhoneRequest({ ...input, signature: "invalid" })).toBe(
      false,
    );
    expect(
      verifyAgentPhoneRequest({ ...input, timestamp: "1791806400junk" }),
    ).toBe(false);
    expect(
      verifyAgentPhoneRequest({
        ...input,
        now: new Date("2026-10-12T12:05:01Z"),
      }),
    ).toBe(false);
    expect(
      verifyAgentPhoneRequest({
        ...input,
        now: new Date("2026-10-12T11:54:59Z"),
      }),
    ).toBe(false);
  });
});
