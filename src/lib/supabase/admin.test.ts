import { afterEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "./admin";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("server-only Supabase client", () => {
  it("uses server credentials without cookies or session persistence", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("SUPABASE_SECRET_KEY", "test-server-secret");
    createAdminClient();
    expect(mocks.createClient).toHaveBeenCalledWith(
      "http://127.0.0.1:54321",
      "test-server-secret",
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
    );
  });

  it.each(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY"])(
    "fails clearly without %s",
    (key) => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
      vi.stubEnv("SUPABASE_SECRET_KEY", "test-server-secret");
      vi.stubEnv(key, "");
      expect(createAdminClient).toThrow("Supabase server credentials are missing");
      expect(mocks.createClient).not.toHaveBeenCalled();
    },
  );
});
