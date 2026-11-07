import { NextRequest } from "next/server";
import { expect, it, vi } from "vitest";
import { updateSession } from "./proxy";

const { getClaims } = vi.hoisted(() => ({ getClaims: vi.fn(async () => ({ data: null })) }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getClaims } }),
}));

it("lets only the exact platform endpoints reach their own authentication without a cookie", async () => {
  for (const path of ["/api/cron/maintenance", "/api/webhooks/resend"]) {
    const response = await updateSession(new NextRequest(`http://localhost${path}`));
    expect(response.headers.get("x-middleware-next")).toBe("1");
  }
  expect(getClaims).not.toHaveBeenCalled();
  for (const path of ["/dashboard", "/api/cron/other", "/api/webhooks/resend/other"]) {
    const response = await updateSession(new NextRequest(`http://localhost${path}`));
    expect(response.headers.get("location")).toBe("http://localhost/sign-in");
  }
});
