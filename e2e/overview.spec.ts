import { expect, test } from "@playwright/test";
import { signIn } from "./fixtures/sign-in";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("overview metrics use honest labels and drill-downs", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
  const summary = page.getByRole("region", { name: "Summary" });
  await expect(summary.getByText("Upcoming bookings", { exact: true })).toBeVisible();
  await expect(summary.getByText("Scheduled from now")).toBeVisible();
  await expect(summary.getByText("Leads", { exact: true })).toBeVisible();
  await expect(summary.getByText("Booking conversion", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "View bookings" })).toHaveAttribute(
    "href",
    "/dashboard/bookings?filter=upcoming&status=booked",
  );
  await expect(page.getByRole("link", { name: "View leads" })).toHaveAttribute(
    "href",
    "/dashboard/leads",
  );

  await page.getByText("Booking activity and definitions").click();
  await expect(page.getByText("Eligible sessions", { exact: true })).toBeVisible();
  await expect(page.getByText(/later cancellation does not undo/i)).toBeVisible();
  await expect(page.getByText("Chat-assisted bookings", { exact: true })).toBeVisible();
  await expect(page.getByText(/recorded booking-confirmation events/i)).toBeVisible();
});
