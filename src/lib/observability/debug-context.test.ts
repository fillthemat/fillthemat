import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/current-user", () => ({ getVerifiedClaims: vi.fn() }));

import { getVerifiedClaims } from "@/lib/auth/current-user";
import {
  debugOwner,
  isDebugSameOrigin,
  issueDebugContext,
  verifyDebugContext,
} from "./debug-context";

const owner = "00000000-0000-4000-8000-000000000010";
const school = "00000000-0000-4000-8000-000000000011";
const configured = {
  CHAT_DEBUG_CAPTURE_ENABLED: "1",
  CHAT_DEBUG_CONTEXT_SECRET: "example-synthetic-secret-long-enough-for-tests",
  CHAT_DEBUG_OPERATOR_IDS: owner,
  LANGFUSE_PUBLIC_KEY: "synthetic-public-key",
  LANGFUSE_SECRET_KEY: "synthetic-secret-key",
  LANGFUSE_BASE_URL: "https://us.cloud.langfuse.com",
  LANGFUSE_PROJECT_ID: "00000000-0000-4000-8000-000000000012",
  NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3010",
};
const previous = Object.fromEntries(
  Object.keys(configured).map((key) => [key, process.env[key]]),
);
beforeEach(() => {
  Object.assign(process.env, configured);
  vi.mocked(getVerifiedClaims).mockResolvedValue({
    id: owner,
    email: "owner@local.test",
    name: null,
  });
});
afterEach(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("debug context", () => {
  it("uses the configured site origin when Next rewrites request.url to localhost", () => {
    expect(
      isDebugSameOrigin(
        new Request("http://localhost:3010/api/chat/debug", {
          headers: { origin: "http://127.0.0.1:3010" },
        }),
      ),
    ).toBe(true);
    expect(
      isDebugSameOrigin(
        new Request("http://localhost:3010/api/chat/debug", {
          headers: { origin: "https://evil.example" },
        }),
      ),
    ).toBe(false);
  });
  it("binds a fresh token to the owner and school; rejects tampering and expiry", () => {
    const signed = issueDebugContext(school, owner, "dbg_fresh");
    expect(verifyDebugContext(signed, school, owner, "dbg_fresh")).toBe(true);
    expect(verifyDebugContext(signed, school, owner, "dbg_other")).toBe(false);
    expect(verifyDebugContext(signed, "other-school", owner, "dbg_fresh")).toBe(
      false,
    );
    expect(verifyDebugContext(signed, school, "other-owner", "dbg_fresh")).toBe(
      false,
    );
    expect(verifyDebugContext(`${signed}a`, school, owner, "dbg_fresh")).toBe(
      false,
    );
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 25 * 60 * 60 * 1000);
    expect(verifyDebugContext(signed, school, owner, "dbg_fresh")).toBe(false);
    vi.restoreAllMocks();
  });
  it("does not treat published preview or a browser token as owner authorization", async () => {
    expect(await debugOwner({ id: school, ownerUserId: owner })).toBe(owner);
    vi.mocked(getVerifiedClaims).mockResolvedValue(null);
    expect(await debugOwner({ id: school, ownerUserId: owner })).toBeNull();
    vi.mocked(getVerifiedClaims).mockResolvedValue({
      id: "other-owner",
      email: "visitor@local.test",
      name: null,
    });
    expect(await debugOwner({ id: school, ownerUserId: owner })).toBeNull();
    process.env.CHAT_DEBUG_OPERATOR_IDS = "other-owner";
    vi.mocked(getVerifiedClaims).mockResolvedValue({
      id: owner,
      email: "owner@local.test",
      name: null,
    });
    expect(await debugOwner({ id: school, ownerUserId: owner })).toBeNull();
    delete process.env.CHAT_DEBUG_CAPTURE_ENABLED;
    expect(await debugOwner({ id: school, ownerUserId: owner })).toBeNull();
  });
});
