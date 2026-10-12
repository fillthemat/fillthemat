import { NextRequest } from "next/server";
import { afterEach, expect, it, vi } from "vitest";
import { proxy } from "./proxy";

const createServerClient = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("Owner auth must not run");
  }),
);
vi.mock("@supabase/ssr", () => ({ createServerClient }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it.each([
  "/poppy/discovery/school/domain",
  "/.well-known/oauth-authorization-server/schools/school",
  "/schools/school/token",
  "/schools/school/revoke",
])("skips owner-session refresh for %s", async (path) => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-key");
  const response = await proxy(new NextRequest(`https://app.example${path}`));
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(createServerClient).not.toHaveBeenCalled();
});
