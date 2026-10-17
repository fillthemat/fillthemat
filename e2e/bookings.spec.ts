import { expect, type Page, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

async function signIn(page: Page) {
  await page.goto("/sign-in");
  const form = page.locator("form", { hasText: "Local email auth" });
  if ((await form.count()) === 0) {
    test.skip(true, "Local email auth is disabled (NEXT_PUBLIC_DEV_AUTH)");
  }
  await form.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard/);
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("booking filters are URL-backed links with selected state", async ({ page }) => {
  await page.goto("/dashboard/bookings");
  const filters = page.getByRole("navigation", { name: "Booking filters" });
  await expect(filters.getByRole("link", { name: "Upcoming" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await filters.getByRole("link", { name: "Past" }).click();
  await expect(page).toHaveURL(/filter=past/);
  await expect(filters.getByRole("link", { name: "Past" })).toHaveAttribute("aria-current", "page");

  await filters.getByRole("link", { name: "All" }).click();
  await expect(page).toHaveURL(/filter=all/);
});

test("booked-only is an optional removable filter", async ({ page }) => {
  await page.goto("/dashboard/bookings?filter=upcoming&status=booked");
  await expect(page.getByText("Booked only")).toBeVisible();
  await page.getByRole("link", { name: "Remove Booked only filter" }).click();
  await expect(page).toHaveURL(/filter=upcoming/);
  await expect(page).not.toHaveURL(/status=booked/);
  await expect(
    page.getByRole("navigation", { name: "Booking filters" }).getByRole("link", {
      name: "Upcoming",
    }),
  ).toHaveAttribute("aria-current", "page");
});

test("cancel confirmation dismisses without submitting", async ({ page }) => {
  await page.goto("/dashboard/bookings?filter=all");
  const cancelButtons = page.getByRole("button", { name: "Cancel" });
  if ((await cancelButtons.count()) === 0) {
    test.skip(true, "No cancellable booking in local demo data");
  }

  await cancelButtons.first().click();
  const dialog = page.getByRole("alertdialog", {
    name: "Cancel this booking?",
  });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(cancelButtons.first()).toBeVisible();
});
