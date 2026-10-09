import { expect, test } from "@playwright/test";

test("the message-limit refusal is a notice and the next message can start afresh", async ({
  page,
}) => {
  await page.goto("/sign-in");
  const form = page.locator("form", { hasText: "Local email auth" });
  test.skip((await form.count()) === 0, "Local email auth is disabled");
  await form.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard/);

  // Exercise the browser's HTTP boundary; lifecycle/storage is covered by
  // the web-turn integration test against real Supabase.
  await page.route("**/api/chat?**", (route) =>
    route.fulfill({
      json: {
        messages: [
          {
            id: "old-reply",
            role: "assistant",
            parts: [{ type: "text", text: "Earlier conversation" }],
          },
        ],
      },
    }),
  );
  let sends = 0;
  await page.route("**/api/chat", async (route) => {
    sends += 1;
    if (sends === 1) {
      await route.fulfill({ status: 429, json: { error: "limit" } });
      return;
    }
    await route.fulfill({
      contentType: "text/event-stream",
      headers: { "x-vercel-ai-ui-message-stream": "v1" },
      body: [
        'data: {"type":"start","messageId":"fresh-reply"}',
        'data: {"type":"text-start","id":"text-1"}',
        'data: {"type":"text-delta","id":"text-1","delta":"A fresh reply"}',
        'data: {"type":"text-end","id":"text-1"}',
        'data: {"type":"finish","finishReason":"stop"}',
        "data: [DONE]",
        "",
      ].join("\n\n"),
    });
  });
  await page.goto("/s/demo?preview=1");
  await expect(
    page.getByText("Earlier conversation", { exact: true }),
  ).toBeVisible();
  const input = page.getByPlaceholder("Ask about classes or times");
  await input.fill("The refused question");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(
    "This conversation has reached its message limit. Your next message starts a fresh conversation.",
  );
  await input.fill("Hello again");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("A fresh reply", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Earlier conversation", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("The refused question", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveCount(0);
});
