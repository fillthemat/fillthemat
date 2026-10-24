import { afterEach, expect, it, vi } from "vitest";
import { createAdminClient } from "./admin";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

it("uses only the server credential and disables session handling", () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("SUPABASE_SECRET_KEY", "server-secret");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-key");
  createAdminClient();
  expect(mocks.createClient).toHaveBeenCalledWith("http://127.0.0.1:54321", "server-secret", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
});

it("fails closed without the server credential, without exposing values", () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("SUPABASE_SECRET_KEY", "");
  expect(createAdminClient).toThrow("Server Supabase configuration is missing");
  expect(mocks.createClient).not.toHaveBeenCalled();
});
