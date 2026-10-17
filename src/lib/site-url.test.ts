import { afterEach, describe, expect, it } from "vitest";
import { getSiteUrl, publicSchoolUrl } from "./site-url";

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL.NEXT_PUBLIC_SITE_URL;
  process.env.VERCEL_ENV = ORIGINAL.VERCEL_ENV;
});

describe("getSiteUrl", () => {
  it("uses the configured production hostname", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://fillthemat.com/";
    process.env.VERCEL_ENV = "production";
    expect(getSiteUrl()).toBe("https://fillthemat.com");
  });

  it("uses trusted preview forwarding headers", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://fillthemat.com";
    process.env.VERCEL_ENV = "preview";
    const headers = new Headers({
      "x-forwarded-host": "fillthemat-git-main-team.vercel.app",
      "x-forwarded-proto": "https",
    });
    expect(getSiteUrl(headers)).toBe("https://fillthemat-git-main-team.vercel.app");
  });

  it("ignores untrusted hosts", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://fillthemat.com";
    process.env.VERCEL_ENV = "preview";
    const headers = new Headers({
      "x-forwarded-host": "evil.example/phish",
    });
    expect(getSiteUrl(headers)).toBe("https://fillthemat.com");
  });
});

describe("publicSchoolUrl", () => {
  it("appends the school path", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://fillthemat.com";
    expect(publicSchoolUrl("tiger-dojo")).toBe("https://fillthemat.com/s/tiger-dojo");
  });
});
