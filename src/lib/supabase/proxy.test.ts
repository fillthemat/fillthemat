import { NextRequest } from "next/server";
import { beforeEach, expect, test, vi } from "vitest";
import { updateSession } from "./proxy";

const { getClaims } = vi.hoisted(() => ({ getClaims: vi.fn() }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: {
      cookies: {
        setAll: (
          cookies: { name: string; value: string }[],
          headers: Record<string, string>,
        ) => void;
      };
    },
  ) => ({
    auth: {
      getClaims: () => {
        options.cookies.setAll([{ name: "session", value: "refreshed" }], {
          "Cache-Control": "private, no-store",
          Pragma: "no-cache",
          Expires: "0",
        });
        return getClaims();
      },
    },
  }),
}));

beforeEach(() => {
  getClaims.mockReset();
  getClaims.mockResolvedValue({ data: null });
});

test.each([
  "/",
  "/?code=oauth-code",
  "/auth/callback?code=oauth-code",
  "/auth/error",
  "/sign-in",
  "/s",
  "/s/",
  "/s/local-school",
  "/api/sessions",
  "/api/chat",
  "/api/bookings",
  "/api/bookings/key",
  "/api/leads",
  "/api/slots",
  "/api/webhooks/whatsapp",
  "/api/webhooks/resend",
  "/api/cron/email-outbox",
  "/dashboardx",
  "/onboardingx",
  "/s/dashboard",
  "/s/%64ashboard",
  "/%64ashboard",
  "/dashboard%2Fx",
  "/invalid%ZZ",
])("signed-out %s passes through with refreshed cookies", async (path) => {
  const response = await updateSession(new NextRequest(`http://localhost${path}`));
  expect(response.status).toBe(200);
  expect(response.headers.get("location")).toBeNull();
  expect(response.cookies.get("session")?.value).toBe("refreshed");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(getClaims).toHaveBeenCalledOnce();
});

test.each([
  "/dashboard",
  "/dashboard/",
  "/dashboard/settings",
  "/dashboard/%73ettings",
  "/onboarding",
  "/onboarding/",
  "/onboarding/step",
])("signed-out %s redirects with refreshed cookies", async (path) => {
  const response = await updateSession(new NextRequest(`http://localhost${path}`));
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toMatch(/^http:\/\/localhost\/sign-in\/?$/);
  expect(response.cookies.get("session")?.value).toBe("refreshed");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("pragma")).toBe("no-cache");
  expect(response.headers.get("expires")).toBe("0");
});

test.each(["/dashboard", "/onboarding"])("signed-in %s passes through", async (path) => {
  getClaims.mockResolvedValue({ data: { claims: { sub: "owner" } } });
  const response = await updateSession(new NextRequest(`http://localhost${path}`));
  expect(response.status).toBe(200);
  expect(response.headers.get("location")).toBeNull();
});
