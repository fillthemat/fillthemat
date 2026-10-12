import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { parseSupabaseStatusEnv, readEnvFile } from "../scripts/local-env";
import { tryCapture } from "../scripts/local-process";

const env = readEnvFile(".env.local");

test("WhatsApp settings: Enable → Meta signup → card → Live and sharing", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(90_000);
  if (!baseURL || env.NEXT_PUBLIC_DEV_AUTH !== "true") {
    test.skip(true, "Requires local Supabase and email auth");
    return;
  }
  const suffix = randomUUID().slice(0, 8);
  const slug = `whatsapp-e2e-${suffix}`;
  const email = `${slug}@local.test`;
  const password = "local-whatsapp-test-password";
  const accountId = `${Date.now()}196`;
  const phoneId = `${Date.now()}197`;
  const resourceId = `PN${randomUUID().replaceAll("-", "")}`;
  let cardAdded = false;
  let numberRegistered = false;
  const vendor = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    let data: unknown;
    if (url.pathname.endsWith("/oauth/access_token"))
      data = { access_token: "e2e-school-token" };
    else if (url.pathname.endsWith("/debug_token"))
      data = {
        data: {
          is_valid: true,
          app_id: "196",
          expires_at: 0,
          granular_scopes: [
            { scope: "whatsapp_business_management", target_ids: [accountId] },
          ],
        },
      };
    else if (url.pathname.endsWith("/phone_numbers"))
      data = { data: [{ id: phoneId, display_phone_number: "+12125550196" }] };
    else if (url.pathname.endsWith("/register")) {
      numberRegistered = true;
      data = { success: true };
    } else if (url.pathname.endsWith("/subscribed_apps"))
      data = { success: true };
    else if (url.pathname.endsWith(`/${phoneId}`))
      data = {
        status: numberRegistered ? "CONNECTED" : "PENDING",
        verified_name: "WhatsApp E2E School",
      };
    else if (url.pathname.endsWith(`/${accountId}`))
      data = cardAdded ? { primary_funding_id: "school-card" } : {};
    else if (url.pathname.includes("/AvailablePhoneNumbers/US/Local.json"))
      data = { available_phone_numbers: [{ phone_number: "+12125550196" }] };
    else if (url.pathname.endsWith("/IncomingPhoneNumbers.json"))
      data =
        request.method === "POST"
          ? { sid: resourceId, phone_number: "+12125550196" }
          : { incoming_phone_numbers: [], next_page_uri: null };
    else {
      response.writeHead(404);
      response.end();
      return;
    }
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(data));
  });
  const sql = postgres(env.DATABASE_URL, { prepare: false, max: 1 });
  const status = tryCapture("bunx", ["supabase", "status", "-o", "env"]);
  if (!status.ok) throw new Error("Local Supabase status unavailable");
  const { apiUrl, serviceRoleKey } = parseSupabaseStatusEnv(status.stdout);
  if (!serviceRoleKey) throw new Error("Missing local admin key");
  const auth = createClient(apiUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  let ownerId: string | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      vendor.once("error", reject);
      vendor.listen(Number(new URL(baseURL).port) + 1, "127.0.0.1", resolve);
    });
    const { data, error } = await auth.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user) throw error ?? new Error("Missing owner");
    ownerId = data.user.id;
    await sql`insert into app.users (id, email) values (${ownerId}, ${email})`;
    await sql`insert into app.schools (owner_user_id, slug, name, timezone, notification_email, public_contact_email, phone, approved_at, published_at) values (${ownerId}, ${slug}, 'WhatsApp E2E School', 'America/New_York', ${email}, 'hello@school.test', '+12125550100', now(), now())`;

    await page.route("https://connect.facebook.net/en_US/sdk.js", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: `window.FB = { init() {}, login(callback) { callback({authResponse: {code: 'fake-popup-code'}}); window.dispatchEvent(new MessageEvent('message', {origin: 'https://www.facebook.com', data: {type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: {waba_id: '${accountId}', phone_number_id: '${phoneId}'}}})); } };`,
      }),
    );
    await page.goto("/sign-in");
    const form = page.locator("form", { hasText: "Local email auth" });
    await form.getByLabel("Email").fill(email);
    await form.getByLabel("Password").fill(password);
    await form.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/dashboard/);
    await page.goto("/dashboard/settings?section=whatsapp");
    await page.getByRole("switch", { name: "Enable WhatsApp" }).click();
    await expect(page.getByText("Reserved number: +12125550196")).toBeVisible();
    await page.getByRole("button", { name: "Prepare Meta signup" }).click();
    await page.getByRole("button", { name: "Open Meta popup" }).click();
    await expect(
      page.getByText("Setup succeeded · Needs card", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("switch", { name: "Enable WhatsApp" }),
    ).toBeChecked();
    await expect(
      page.getByRole("link", { name: "Add payment card in WhatsApp Manager" }),
    ).toHaveAttribute(
      "href",
      `https://business.facebook.com/wa/manage/home/?waba_id=${accountId}`,
    );
    await expect(
      page.getByText(/Meta bills your school directly/),
    ).toBeVisible();
    await page.getByRole("button", { name: "Check readiness" }).click();
    await expect(
      page.getByText(/After adding your card, check again/),
    ).toBeVisible();
    const publicPage = await context.newPage();
    await publicPage.goto(`/s/${slug}`);
    await expect(
      publicPage.getByRole("link", { name: "Chat with us on WhatsApp" }),
    ).toHaveCount(0);

    cardAdded = true; // Fake the owner adding funding at Meta, never toggle state in our DB.
    await page.getByRole("button", { name: "Check readiness" }).click();
    await expect(
      page.getByText("Live · Working", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Profile name: WhatsApp E2E School"),
    ).toBeVisible();
    await expect(
      page.getByRole("link", {
        name: "https://wa.me/12125550196",
        exact: true,
      }),
    ).toHaveAttribute("href", "https://wa.me/12125550196");
    await page.getByRole("switch", { name: "Enable WhatsApp" }).click();
    const offDialog = page.getByRole("alertdialog", {
      name: "Switch WhatsApp off?",
    });
    await expect(offDialog).toBeVisible();
    await expect(offDialog).toContainText(
      "Old links and QR codes stop working after release.",
    );
    await expect(offDialog).toContainText("Your number will be released on");
    await offDialog.getByRole("button", { name: "Keep WhatsApp on" }).click();
    await expect(
      page.getByRole("switch", { name: "Enable WhatsApp" }),
    ).toBeChecked();
    await page.getByRole("switch", { name: "Enable WhatsApp" }).click();
    await offDialog
      .getByRole("button", { name: "Switch off", exact: true })
      .click();
    await expect(
      page.getByText("Off · Cooling-off", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("switch", { name: "Enable WhatsApp" }),
    ).not.toBeChecked();
    await expect(page.getByText("Reserved number: +12125550196")).toBeVisible();
    await expect(
      page.getByText(/Your number will be released on/),
    ).toBeVisible();
    await publicPage.reload();
    await expect(
      publicPage.getByRole("link", { name: "Chat with us on WhatsApp" }),
    ).toHaveCount(0);
    await page.getByRole("switch", { name: "Enable WhatsApp" }).click();
    await expect(
      page.getByText("Live · Working", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("WhatsApp number: +12125550196")).toBeVisible();
    const qr = page.getByRole("img", { name: "WhatsApp QR code" });
    await expect(qr).toBeVisible();
    await expect(qr).toHaveAttribute("src", /^data:image\/png;base64,/);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByRole("button", { name: "Copy WhatsApp link" }).click();
    await expect(page.getByText("WhatsApp link copied.")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      "https://wa.me/12125550196",
    );
    await publicPage.reload();
    await expect(
      publicPage.getByRole("link", { name: "Chat with us on WhatsApp" }),
    ).toHaveAttribute("href", "https://wa.me/12125550196");
  } finally {
    if (ownerId) {
      await sql`delete from app.users where id = ${ownerId}`;
      await auth.auth.admin.deleteUser(ownerId);
    }
    await sql.end({ timeout: 5 });
    await new Promise<void>((resolve) => vendor.close(() => resolve()));
  }
});
