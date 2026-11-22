import { expect, test } from "@playwright/test";
import { authSql, loadLocalEnv } from "../src/test/integration-env";
import { signIn } from "./fixtures/sign-in";

test("an owner can register, set a new password, sign out and return to the same school", async ({
  page,
}) => {
  loadLocalEnv();
  const sql = authSql();
  const slug = `review-${crypto.randomUUID().slice(0, 8)}`;
  const email = `${slug}@example.com`;
  const password = crypto.randomUUID();
  try {
    await page.goto("/sign-in");
    await page.getByRole("link", { name: /Create an account/ }).click();
    await expect(page.getByRole("heading", { name: "Create an account" })).toBeVisible();
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(crypto.randomUUID());
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/onboarding/);
    await page.getByLabel("School name").fill("Review Mat");
    await page.getByLabel("Public URL slug").fill(slug);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("link", { name: "Account", exact: true }).click();
    await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
    await expect(page.getByRole("button", { name: "Link Google account" })).toBeVisible();
    await page.getByLabel("New password").fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await page.getByRole("button", { name: "Save password" }).click();
    await expect(page.getByRole("status")).toContainText("Password saved");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    await page.goto("/dashboard/account");
    await expect(page).toHaveURL(/\/sign-in/);
    await signIn(page, email, password);
    await expect(page.getByRole("banner")).toContainText("Review Mat");
  } finally {
    await sql`delete from public.schools where slug = ${slug}`;
    await sql`delete from auth.users where email = ${email}`;
    await sql.end();
  }
});
