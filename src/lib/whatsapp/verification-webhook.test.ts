import { describe, expect, it } from "vitest";
import { verifyTwilioRequest } from "./verification-webhook";

describe("Twilio verification webhook", () => {
  it("validates Twilio's published signature vector including every form field and the query string", () => {
    const params = new URLSearchParams({
      CallSid: "CA1234567890ABCDE",
      Caller: "+14158675310",
      Digits: "1234",
      From: "+14158675310",
      To: "+18005551212",
    });
    const input = {
      url: "https://example.com/myapp.php?foo=1&bar=2",
      params,
      authToken: "12345",
      signature: "L/OH5YylLD5NRKLltdqwSvS0BnU=",
    };
    expect(verifyTwilioRequest(input)).toBe(true);
    expect(verifyTwilioRequest({ ...input, signature: "invalid" })).toBe(false);
    expect(
      verifyTwilioRequest({ ...input, url: "https://attacker.test" }),
    ).toBe(false);
    params.set("To", "+18005551213");
    expect(verifyTwilioRequest(input)).toBe(false);
  });
});
