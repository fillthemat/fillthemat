# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: whatsapp-settings.spec.ts >> WhatsApp settings: Enable → Meta signup → card → Live and sharing
- Location: e2e/whatsapp-settings.spec.ts:11:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('Setup succeeded · Needs card', { exact: true })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByText('Setup succeeded · Needs card', { exact: true })

```

```yaml
- link "Skip to content":
  - /url: "#main-content"
- banner:
  - paragraph: WhatsApp E2E School
  - navigation "Dashboard":
    - list:
      - listitem:
        - link "Overview":
          - /url: /dashboard
      - listitem:
        - link "Bookings":
          - /url: /dashboard/bookings
      - listitem:
        - link "Leads":
          - /url: /dashboard/leads
      - listitem:
        - link "Conversations":
          - /url: /dashboard/conversations
      - listitem:
        - link "Settings":
          - /url: /dashboard/settings
- main:
  - heading "Settings" [level=1]
  - navigation "Settings categories":
    - list:
      - listitem:
        - link "School":
          - /url: /dashboard/settings
      - listitem:
        - link "Trial classes":
          - /url: /dashboard/settings?section=offerings
      - listitem:
        - link "Schedule":
          - /url: /dashboard/settings?section=schedule
      - listitem:
        - link "Pricing":
          - /url: /dashboard/settings?section=pricing
      - listitem:
        - link "FAQs":
          - /url: /dashboard/settings?section=faqs
      - listitem:
        - link "Agent":
          - /url: /dashboard/settings?section=agent
      - listitem:
        - link "Branding":
          - /url: /dashboard/settings?section=branding
      - listitem:
        - link "WhatsApp":
          - /url: /dashboard/settings?section=whatsapp
  - region "WhatsApp":
    - heading "WhatsApp" [level=2]
    - text: Enable WhatsApp
    - paragraph: Let prospects reach your school’s Assistant on WhatsApp.
    - switch "Enable WhatsApp" [disabled]
    - paragraph: Ready to set up
    - list:
      - listitem: "School approved : complete"
      - listitem: "School page published : complete"
      - listitem: "School phone set : complete"
      - listitem: "Public contact email set : complete"
    - paragraph: Your school owns its WhatsApp account
    - text: Fillthemat buys and pays for a new US number. Your existing number stays untouched. You authorize your school’s account in Meta’s one-time popup and add your school’s card in WhatsApp Manager to pay Meta’s message fees. The Assistant shares your school phone and public contact email when someone asks for a person; your notification email stays private.
    - list:
      - listitem:
        - paragraph: 1. New US number — Succeeded
        - paragraph: Fillthemat purchases it in the background.
      - listitem:
        - paragraph: 2. One-time Meta signup — Not completed
        - paragraph: Facebook → business → school profile → new number → verification code → terms.
      - listitem:
        - paragraph: 3. Number registration — Not completed
        - paragraph: Fillthemat registers your number with Meta.
      - listitem:
        - paragraph: 4. School card in Meta — Not confirmed
        - paragraph: Your school pays Meta directly. Live requires a registered number and a card on file.
    - text: Meta signup failed
    - paragraph:
      - text: "Reserved number:"
      - strong: "+12125550196"
    - paragraph: Your number and verification code
    - paragraph:
      - text: Enter
      - strong: "+12125550196"
      - text: as your new WhatsApp number in Meta’s popup.
    - paragraph:
      - text: "Verification code:"
      - strong: Open the popup to request a code
    - paragraph: Keep settings open beside the popup. Use your school’s name for the profile. Your existing WhatsApp number stays untouched.
    - button "Retry Meta signup"
    - status: Meta setup failed. Your number is kept; try again.
    - status: Your number is reserved. Continue with Meta signup next; WhatsApp is not Live yet.
- alert
```

# Test source

```ts
  25  |   const accountId = `${Date.now()}196`;
  26  |   const phoneId = `${Date.now()}197`;
  27  |   const resourceId = `PN${randomUUID().replaceAll("-", "")}`;
  28  |   let cardAdded = false;
  29  |   let numberRegistered = false;
  30  |   let messagingAvailable = true;
  31  |   const vendor = createServer((request, response) => {
  32  |     const url = new URL(request.url ?? "/", "http://127.0.0.1");
  33  |     let data: unknown;
  34  |     if (url.pathname.endsWith("/oauth/access_token"))
  35  |       data = { access_token: "e2e-school-token" };
  36  |     else if (url.pathname.endsWith("/debug_token"))
  37  |       data = {
  38  |         data: {
  39  |           is_valid: true,
  40  |           app_id: "196",
  41  |           expires_at: 0,
  42  |           granular_scopes: [
  43  |             { scope: "whatsapp_business_management", target_ids: [accountId] },
  44  |           ],
  45  |         },
  46  |       };
  47  |     else if (url.pathname.endsWith("/phone_numbers"))
  48  |       data = { data: [{ id: phoneId, display_phone_number: "+12125550196" }] };
  49  |     else if (url.pathname.endsWith("/register")) {
  50  |       numberRegistered = true;
  51  |       data = { success: true };
  52  |     } else if (
  53  |       url.pathname.endsWith("/subscribed_apps") ||
  54  |       url.pathname.endsWith("/subscriptions")
  55  |     )
  56  |       data = { success: true };
  57  |     else if (url.pathname.endsWith(`/${phoneId}`))
  58  |       data = {
  59  |         status: numberRegistered ? "CONNECTED" : "PENDING",
  60  |         verified_name: "WhatsApp E2E School",
  61  |         health_status: {
  62  |           can_send_message: messagingAvailable ? "AVAILABLE" : "BLOCKED",
  63  |         },
  64  |       };
  65  |     else if (url.pathname.endsWith(`/${accountId}`))
  66  |       data = cardAdded ? { primary_funding_id: "school-card" } : {};
  67  |     else if (url.pathname.includes("/AvailablePhoneNumbers/US/Local.json"))
  68  |       data = { available_phone_numbers: [{ phone_number: "+12125550196" }] };
  69  |     else if (url.pathname.endsWith("/IncomingPhoneNumbers.json"))
  70  |       data =
  71  |         request.method === "POST"
  72  |           ? { sid: resourceId, phone_number: "+12125550196" }
  73  |           : { incoming_phone_numbers: [], next_page_uri: null };
  74  |     else {
  75  |       response.writeHead(404);
  76  |       response.end();
  77  |       return;
  78  |     }
  79  |     response.setHeader("Content-Type", "application/json");
  80  |     response.end(JSON.stringify(data));
  81  |   });
  82  |   const sql = postgres(env.DATABASE_URL, { prepare: false, max: 1 });
  83  |   const status = tryCapture("bunx", ["supabase", "status", "-o", "env"]);
  84  |   if (!status.ok) throw new Error("Local Supabase status unavailable");
  85  |   const { apiUrl, serviceRoleKey } = parseSupabaseStatusEnv(status.stdout);
  86  |   if (!serviceRoleKey) throw new Error("Missing local admin key");
  87  |   const auth = createClient(apiUrl, serviceRoleKey, {
  88  |     auth: { persistSession: false },
  89  |   });
  90  |   let ownerId: string | undefined;
  91  |   try {
  92  |     await new Promise<void>((resolve, reject) => {
  93  |       vendor.once("error", reject);
  94  |       vendor.listen(Number(new URL(baseURL).port) + 1, "127.0.0.1", resolve);
  95  |     });
  96  |     const { data, error } = await auth.auth.admin.createUser({
  97  |       email,
  98  |       password,
  99  |       email_confirm: true,
  100 |     });
  101 |     if (error || !data.user) throw error ?? new Error("Missing owner");
  102 |     ownerId = data.user.id;
  103 |     await sql`insert into app.users (id, email) values (${ownerId}, ${email})`;
  104 |     await sql`insert into app.schools (owner_user_id, slug, name, timezone, notification_email, public_contact_email, phone, approved_at, published_at) values (${ownerId}, ${slug}, 'WhatsApp E2E School', 'America/New_York', ${email}, 'hello@school.test', '+12125550100', now(), now())`;
  105 | 
  106 |     await page.route("https://connect.facebook.net/en_US/sdk.js", (route) =>
  107 |       route.fulfill({
  108 |         contentType: "application/javascript",
  109 |         body: `window.FB = { init() {}, login(callback) { callback({authResponse: {code: 'fake-popup-code'}}); window.dispatchEvent(new MessageEvent('message', {origin: 'https://www.facebook.com', data: {type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: {waba_id: '${accountId}', phone_number_id: '${phoneId}'}}})); } };`,
  110 |       }),
  111 |     );
  112 |     await page.goto("/sign-in");
  113 |     const form = page.locator("form", { hasText: "Local email auth" });
  114 |     await form.getByLabel("Email").fill(email);
  115 |     await form.getByLabel("Password").fill(password);
  116 |     await form.getByRole("button", { name: "Sign in" }).click();
  117 |     await page.waitForURL(/\/dashboard/);
  118 |     await page.goto("/dashboard/settings?section=whatsapp");
  119 |     await page.getByRole("switch", { name: "Enable WhatsApp" }).click();
  120 |     await expect(page.getByText("Reserved number: +12125550196")).toBeVisible();
  121 |     await page.getByRole("button", { name: "Prepare Meta signup" }).click();
  122 |     await page.getByRole("button", { name: "Open Meta popup" }).click();
  123 |     await expect(
  124 |       page.getByText("Setup succeeded · Needs card", { exact: true }),
> 125 |     ).toBeVisible();
      |       ^ Error: expect(locator).toBeVisible() failed
  126 |     await expect(
  127 |       page.getByRole("switch", { name: "Enable WhatsApp" }),
  128 |     ).toBeChecked();
  129 |     await expect(
  130 |       page.getByRole("link", { name: "Add payment card in WhatsApp Manager" }),
  131 |     ).toHaveAttribute(
  132 |       "href",
  133 |       `https://business.facebook.com/wa/manage/home/?waba_id=${accountId}`,
  134 |     );
  135 |     await expect(
  136 |       page.getByText(/Meta bills your school directly/),
  137 |     ).toBeVisible();
  138 |     await page.getByRole("button", { name: "Check readiness" }).click();
  139 |     await expect(
  140 |       page.getByText(/After adding your card, check again/),
  141 |     ).toBeVisible();
  142 |     const publicPage = await context.newPage();
  143 |     await publicPage.goto(`/s/${slug}`);
  144 |     await expect(
  145 |       publicPage.getByRole("link", { name: "Chat with us on WhatsApp" }),
  146 |     ).toHaveCount(0);
  147 | 
  148 |     cardAdded = true; // Fake the owner adding funding at Meta, never toggle state in our DB.
  149 |     await page.getByRole("button", { name: "Check readiness" }).click();
  150 |     await expect(
  151 |       page.getByText("Live · Working", { exact: true }),
  152 |     ).toBeVisible();
  153 |     await expect(
  154 |       page.getByText("Profile name: WhatsApp E2E School"),
  155 |     ).toBeVisible();
  156 |     await expect(
  157 |       page.getByRole("link", {
  158 |         name: "https://wa.me/12125550196",
  159 |         exact: true,
  160 |       }),
  161 |     ).toHaveAttribute("href", "https://wa.me/12125550196");
  162 |     await page.getByRole("switch", { name: "Enable WhatsApp" }).click();
  163 |     const offDialog = page.getByRole("alertdialog", {
  164 |       name: "Switch WhatsApp off?",
  165 |     });
  166 |     await expect(offDialog).toBeVisible();
  167 |     await expect(offDialog).toContainText(
  168 |       "Old links and QR codes stop working after release.",
  169 |     );
  170 |     await expect(offDialog).toContainText("Your number will be released on");
  171 |     await offDialog.getByRole("button", { name: "Keep WhatsApp on" }).click();
  172 |     await expect(
  173 |       page.getByRole("switch", { name: "Enable WhatsApp" }),
  174 |     ).toBeChecked();
  175 |     await page.getByRole("switch", { name: "Enable WhatsApp" }).click();
  176 |     await offDialog
  177 |       .getByRole("button", { name: "Switch off", exact: true })
  178 |       .click();
  179 |     await expect(
  180 |       page.getByText("Off · Cooling-off", { exact: true }),
  181 |     ).toBeVisible();
  182 |     await expect(
  183 |       page.getByRole("switch", { name: "Enable WhatsApp" }),
  184 |     ).not.toBeChecked();
  185 |     await expect(page.getByText("Reserved number: +12125550196")).toBeVisible();
  186 |     await expect(
  187 |       page.getByText(/Your number will be released on/),
  188 |     ).toBeVisible();
  189 |     await publicPage.reload();
  190 |     await expect(
  191 |       publicPage.getByRole("link", { name: "Chat with us on WhatsApp" }),
  192 |     ).toHaveCount(0);
  193 |     await page.getByRole("switch", { name: "Enable WhatsApp" }).click();
  194 |     await expect(
  195 |       page.getByText("Live · Working", { exact: true }),
  196 |     ).toBeVisible();
  197 |     await expect(page.getByText("WhatsApp number: +12125550196")).toBeVisible();
  198 |     const qr = page.getByRole("img", { name: "WhatsApp QR code" });
  199 |     await expect(qr).toBeVisible();
  200 |     await expect(qr).toHaveAttribute("src", /^data:image\/png;base64,/);
  201 |     await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  202 |     await page.getByRole("button", { name: "Copy WhatsApp link" }).click();
  203 |     await expect(page.getByText("WhatsApp link copied.")).toBeVisible();
  204 |     expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
  205 |       "https://wa.me/12125550196",
  206 |     );
  207 |     await publicPage.reload();
  208 |     await expect(
  209 |       publicPage.getByRole("link", { name: "Chat with us on WhatsApp" }),
  210 |     ).toHaveAttribute("href", "https://wa.me/12125550196");
  211 | 
  212 |     let eventTime = Math.ceil(Date.now() / 1000) + 1;
  213 |     const accountEvent = async (event: string, extra = {}) => {
  214 |       const payload = JSON.stringify({
  215 |         object: "whatsapp_business_account",
  216 |         entry: [
  217 |           {
  218 |             id: accountId,
  219 |             time: eventTime++,
  220 |             changes: [{ field: "account_update", value: { event, ...extra } }],
  221 |           },
  222 |         ],
  223 |       });
  224 |       const response = await page.request.post("/api/webhooks/whatsapp", {
  225 |         data: payload,
```