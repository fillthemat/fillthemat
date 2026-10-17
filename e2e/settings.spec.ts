import { expect, type Page, test } from "@playwright/test";

/**
 * Owner settings UI. Requires the local stack from `docs/local-development.md`
 * (`bun run setup` seeds owner@local.test and the "demo" school).
 */

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

test("every category is deep-linkable and marked current", async ({ page }) => {
  const sections: Array<[string, string]> = [
    ["profile", "School details"],
    ["offerings", "Trial classes"],
    ["schedule", "Weekly schedule"],
    ["pricing", "Pricing"],
    ["faqs", "Frequently asked questions"],
    ["agent", "Your agent"],
    ["branding", "Branding"],
  ];

  for (const [section, heading] of sections) {
    await page.goto(`/dashboard/settings?section=${section}`);
    await expect(page.locator("#section-title")).toHaveText(heading);
    await expect(
      page
        .getByRole("navigation", { name: "Settings categories" })
        .locator("a[aria-current='page']"),
    ).toHaveCount(1);
  }
});

test("an unknown category falls back to the first one", async ({ page }) => {
  await page.goto("/dashboard/settings?section=not-a-section");
  await expect(page.locator("#section-title")).toHaveText("School details");
});

test("navigation keeps browser history predictable", async ({ page }) => {
  await page.goto("/dashboard/settings");
  await page
    .getByRole("navigation", { name: "Settings categories" })
    .getByRole("link", { name: /Pricing/ })
    .click();
  await expect(page.locator("#section-title")).toHaveText("Pricing");
  await page.goBack();
  await expect(page.locator("#section-title")).toHaveText("School details");
  await page.goForward();
  await expect(page.locator("#section-title")).toHaveText("Pricing");
});

test("invalid input shows an inline error and keeps what was typed", async ({ page }) => {
  await page.goto("/dashboard/settings");
  const name = page.getByLabel(/School name/);
  const original = await name.inputValue();
  const city = page.getByLabel(/^City/);
  await name.fill("");
  await city.fill("Brooklyn Heights");
  await page.getByRole("button", { name: "Save School Details" }).click();

  await expect(page.getByText("Add the name families should hear.")).toBeVisible();
  // Nothing the owner typed is thrown away on a failed save.
  await expect(city).toHaveValue("Brooklyn Heights");
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(name).toBeFocused();

  await name.fill(original);
});

test("a valid save reports success and clears the unsaved state", async ({ page }) => {
  await page.goto("/dashboard/settings");
  const parking = page.getByLabel(/^Parking/);
  // The local Supabase stack is shared, so put this field back afterwards.
  const original = await parking.inputValue();
  const value = `Lot behind the building. ${Date.now()}`;
  await parking.fill(value);
  await expect(page.getByRole("status").filter({ hasText: "Unsaved changes" })).toBeVisible();

  await page.getByRole("button", { name: "Save School Details" }).click();
  await expect(page.getByText("School details saved. Your agent uses them now.")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel(/^Parking/)).toHaveValue(value);

  await page.getByLabel(/^Parking/).fill(original);
  await page.getByRole("button", { name: "Save School Details" }).click();
  await expect(page.getByText("School details saved. Your agent uses them now.")).toBeVisible();
});

test("updating spots confirms the save and leaves no unsaved state", async ({ page }) => {
  await page.goto("/dashboard/settings?section=schedule");
  const row = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("button", { name: "Update Spots" }) })
    .first();
  const spots = row.getByLabel(/Spots per class/);
  const original = await spots.inputValue();
  const next = String(Number(original) + 1);

  await spots.fill(next);
  await row.getByRole("button", { name: "Update Spots" }).click();

  await expect(
    row.getByRole("status").filter({ hasText: "Upcoming classes now hold" }),
  ).toBeVisible();
  await expect(spots).toHaveValue(next);
  // Baseline moved with the save: nothing to discard, nothing to warn about.
  await expect(row.getByRole("button", { name: "Discard" })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Update Spots" })).toBeDisabled();

  await spots.fill(original);
  await row.getByRole("button", { name: "Update Spots" }).click();
  await expect(spots).toHaveValue(original);
});

test("saving shows the value the server stored", async ({ page }) => {
  await page.goto("/dashboard/settings");
  await page.getByLabel(/Country code/).fill("us");
  await page.getByRole("button", { name: "Save School Details" }).click();

  await expect(page.getByLabel(/Country code/)).toHaveValue("US");
  await expect(page.getByRole("status").filter({ hasText: "Unsaved changes" })).toHaveCount(0);
});

test("switching categories with unsaved edits asks first", async ({ page }) => {
  await page.goto("/dashboard/settings?section=pricing");
  await page.getByLabel(/Prices and conditions/).fill("Trial class: free for first-time students.");

  await page
    .getByRole("navigation", { name: "Settings categories" })
    .getByRole("link", { name: /FAQs/ })
    .click();

  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Keep Editing" }).click();
  await expect(page.locator("#section-title")).toHaveText("Pricing");

  await page
    .getByRole("navigation", { name: "Settings categories" })
    .getByRole("link", { name: /FAQs/ })
    .click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Discard Changes" }).click();
  await expect(page.locator("#section-title")).toHaveText("Frequently asked questions");
});

test("adding and deleting a question requires confirmation to delete", async ({ page }) => {
  const question = `Is there parking for the trial? ${Date.now()}`;
  await page.goto("/dashboard/settings?section=faqs");

  const addButton = page.getByRole("button", { name: "Add a Question" });
  if (await addButton.isVisible()) await addButton.click();

  await page.getByLabel(/^Question/).fill(question);
  await page.getByLabel(/^Answer/).fill("Yes, there is a free lot behind us.");
  await page.getByRole("button", { name: "Add Question" }).click();

  const item = page.getByRole("listitem").filter({ hasText: question });
  await expect(item).toBeVisible();

  await item.getByRole("button", { name: "Delete" }).click();
  const dialog = page.getByRole("alertdialog", {
    name: "Delete this question?",
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Delete Question" }).click();

  await expect(page.getByRole("listitem").filter({ hasText: question })).toHaveCount(0);
});

test("a class time can be added, then deleted after confirming", async ({ page }) => {
  await page.goto("/dashboard/settings?section=schedule");

  const addButton = page.getByRole("button", { name: "Add a Class Time" });
  if (await addButton.isVisible()) await addButton.click();

  await page.getByLabel(/Day of the week/).selectOption("2");
  await page.getByLabel(/Start time/).fill("19:15");
  await page.getByLabel(/Class length in minutes/).fill("45");
  await page.getByLabel(/^Internal label/).fill("Playwright temp window");
  await page.getByRole("button", { name: "Add Class Time" }).click();

  const row = page.getByRole("listitem").filter({ hasText: "Playwright temp window" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("7:15 PM – 8:00 PM");

  // Escape closes the confirmation without deleting anything.
  await row.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete Class Time" }).click();
  await expect(
    page.getByRole("listitem").filter({ hasText: "Playwright temp window" }),
  ).toHaveCount(0);
});

test("a trial class can be edited, saved, reloaded, and edited again", async ({ page }) => {
  await page.goto("/dashboard/settings?section=offerings");
  const row = page
    .getByRole("region", { name: "Your trial classes" })
    .getByRole("listitem")
    .filter({ hasText: "Kids beginner trial" })
    .first();
  await row.getByRole("button", { name: "Edit" }).click();

  const name = page.getByLabel(/Class name/);
  const original = await name.inputValue();
  const next = `Corrected class ${Date.now()}`;
  await name.fill(next);
  await page.getByLabel(/Youngest age/).fill("7");
  await page.getByRole("button", { name: "Save Changes" }).click();

  const savedRow = page.getByRole("listitem").filter({ hasText: next });
  await expect(page.getByRole("status").filter({ hasText: /saved/i })).toBeVisible();
  await expect(savedRow.getByRole("button", { name: "Edit" })).toBeFocused();

  await page.reload();
  const reloaded = page.getByRole("listitem").filter({ hasText: next });
  await expect(reloaded).toBeVisible();
  await reloaded.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByLabel(/Class name/)).toHaveValue(next);
  await expect(page.getByLabel(/Youngest age/)).toHaveValue("7");

  await page.getByLabel(/Class name/).fill(original);
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByRole("status").filter({ hasText: /saved/i })).toBeVisible();
});

test("cancel on a clean editor closes immediately without asking", async ({ page }) => {
  await page.goto("/dashboard/settings?section=offerings");
  const row = page
    .getByRole("region", { name: "Your trial classes" })
    .getByRole("listitem")
    .filter({ hasText: "Kids beginner trial" })
    .first();
  await row.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByRole("button", { name: "Save Changes" })).toBeVisible();

  await page.getByRole("button", { name: "Cancel" }).click();

  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save Changes" })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Edit" })).toBeVisible();
});

test("switching records while dirty asks before discarding", async ({ page }) => {
  await page.goto("/dashboard/settings?section=offerings");
  const row = page
    .getByRole("region", { name: "Your trial classes" })
    .getByRole("listitem")
    .filter({ hasText: "Kids beginner trial" })
    .first();
  await row.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel(/Class name/).fill("Unsaved draft name");

  await page.getByRole("button", { name: "Add a Trial Class" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Keep Editing" }).click();
  await expect(page.getByLabel(/Class name/)).toHaveValue("Unsaved draft name");

  await page.getByRole("button", { name: "Add a Trial Class" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Discard Changes" }).click();
  await expect(page.getByRole("group", { name: /Add a trial class/i })).toBeVisible();
});

test("cancel on a clean FAQ editor closes immediately without asking", async ({ page }) => {
  const question = `Idle cancel FAQ ${Date.now()}`;
  await page.goto("/dashboard/settings?section=faqs");
  const addButton = page.getByRole("button", { name: "Add a Question" });
  if (await addButton.isVisible()) await addButton.click();

  await page.getByLabel(/^Question/).fill(question);
  await page.getByLabel(/^Answer/).fill("Temporary.");
  await page.getByRole("button", { name: "Add Question" }).click();

  const item = page.getByRole("listitem").filter({ hasText: question });
  await expect(item).toBeVisible();
  await item.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByRole("button", { name: "Save Changes" })).toBeVisible();

  await page.getByRole("button", { name: "Cancel" }).click();

  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save Changes" })).toHaveCount(0);
  await expect(item.getByRole("button", { name: "Edit" })).toBeVisible();

  await item.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete Question" }).click();
});

test("an FAQ can be edited without deleting it", async ({ page }) => {
  const question = `Parking for the trial? ${Date.now()}`;
  await page.goto("/dashboard/settings?section=faqs");

  const addButton = page.getByRole("button", { name: "Add a Question" });
  if (await addButton.isVisible()) await addButton.click();

  await page.getByLabel(/^Question/).fill(question);
  await page.getByLabel(/^Answer/).fill("Yes, there is a free lot.");
  await page.getByRole("button", { name: "Add Question" }).click();

  const item = page.getByRole("listitem").filter({ hasText: question });
  await expect(item).toBeVisible();
  await item.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel(/^Answer/).fill("Yes — street parking too.");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByRole("status").filter({ hasText: /saved/i })).toBeVisible();

  await item.locator("summary").click();
  await expect(item.getByText("Yes — street parking too.")).toBeVisible();

  await item.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete Question" }).click();
});
