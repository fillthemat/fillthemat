import type { Page } from "@playwright/test";

export async function signIn(
  page: Page,
  email = "owner@local.test",
  password = "local-dev-password",
) {
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/dashboard/);
}
