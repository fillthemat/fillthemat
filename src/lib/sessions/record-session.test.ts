import { beforeEach, expect, it, vi } from "vitest";
import { hashToken } from "@/lib/crypto";
import { recordLandingSession } from "./record-session";

const mocks = vi.hoisted(() => ({ getSchool: vi.fn(), admin: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/schools/public", () => ({ getSchoolForLandingAccess: mocks.getSchool }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
const input = { slug: "demo", token: "visitor-session-token", userAgent: "Mozilla/5.0" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSchool.mockResolvedValue({ id: "school-id" });
  mocks.admin.mockReturnValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data: true, error: null });
});

it("checks school access before creating the privileged client, including previews", async () => {
  mocks.getSchool.mockResolvedValue(null);
  expect(await recordLandingSession({ ...input, preview: true })).toEqual({ status: "not_found" });
  expect(mocks.getSchool).toHaveBeenCalledWith("demo", { preview: true });
  expect(mocks.admin).not.toHaveBeenCalled();
});

it("sends only a token hash and bounded attribution to the atomic write", async () => {
  expect(
    await recordLandingSession({
      ...input,
      utm: {
        utm_source: "x".repeat(250),
        utm_medium: "referral",
        utm_campaign: "summer",
        utm_content: "banner",
        utm_term: "trial",
        unexpected: "must not reach the RPC",
        ...Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`extra_${i}`, "ignored"])),
      },
    }),
  ).toEqual({
    status: "recorded",
    qualified: true,
  });
  expect(mocks.rpc).toHaveBeenCalledWith("record_landing_session", {
    p_school_id: "school-id",
    p_session_key_hash: hashToken(input.token),
    p_is_preview: false,
    p_bot_exclusion_reason: undefined,
    p_utm: {
      utm_source: "x".repeat(200),
      utm_medium: "referral",
      utm_campaign: "summer",
      utm_content: "banner",
      utm_term: "trial",
    },
  });
});

it("passes preview and bot exclusions and preserves the stored qualification", async () => {
  mocks.rpc.mockResolvedValue({ data: false, error: null });
  expect(await recordLandingSession({ ...input, preview: true, userAgent: "Googlebot" })).toEqual({
    status: "recorded",
    qualified: false,
  });
  expect(mocks.rpc.mock.calls[0]?.[1]).toMatchObject({
    p_is_preview: true,
    p_bot_exclusion_reason: "user_agent",
  });
});

it("does not report success when persistence fails", async () => {
  const error = new Error("database unavailable");
  mocks.rpc.mockResolvedValue({ data: null, error });
  await expect(recordLandingSession(input)).rejects.toThrow(error);
});
