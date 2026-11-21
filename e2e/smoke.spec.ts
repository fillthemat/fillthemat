import { expect, test } from "@playwright/test";

test("signed-out home shows the landing page", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Turn martial arts interest into booked trial classes.",
  );
});

test("signed-out routing leaves public handlers in control", async ({ request }) => {
  for (const path of ["/dashboard", "/onboarding"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(new URL(response.headers().location ?? "", response.url()).pathname).toBe("/sign-in");
  }

  const handoff = await request.get("/?code=test-code", { maxRedirects: 0 });
  expect(new URL(handoff.headers().location ?? "", handoff.url()).pathname).toBe("/auth/callback");
  const callback = await request.get("/auth/callback", { maxRedirects: 0 });
  expect(new URL(callback.headers().location ?? "", callback.url()).pathname).toBe("/auth/error");

  const key = await request.post("/api/bookings/key");
  expect(key.status()).toBe(200);
  expect(await key.json()).toHaveProperty("idempotencyKey");
  for (const path of ["/api/chat", "/api/bookings", "/api/leads"]) {
    const response = await request.post(path, { data: {}, maxRedirects: 0 });
    expect(response.status()).toBe(400);
    expect(await response.json()).toHaveProperty("error", "invalid");
  }
  for (const path of ["/api/cron/maintenance", "/api/cron/whatsapp"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(401);
  }
});
