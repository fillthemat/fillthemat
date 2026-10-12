# Research: Meta prerequisites for school-owned WhatsApp onboarding

**Date checked:** 2026-10-11. **Status:** research resolution for [#131](https://github.com/fillthemat/fillthemat/issues/131), part of [#129](https://github.com/fillthemat/fillthemat/issues/129); not an implementation or a binding ADR.

**Baseline:** `origin/main` at `9004dcc`; `docs/whatsapp-plan.md` D9 and the entire `docs/whatsapp-phase6-kickoff.md` checklist. Existing research notes live in `docs/decisions/`, so this note follows that convention. No app, database, environment, or Meta account was changed.

## Answer in brief

Fillthemat needs to become a **Tech Provider**, using its own verified business portfolio and Business-type Meta app, and obtain **App Review Advanced Access** plus the separate **Access Verification**. Neither Solution Partner nor Tech Partner status is required for Embedded Signup with coexistence. Schools own their WhatsApp assets; Fillthemat holds a customer-scoped Business Integration System User (BISU) token for each installation, rather than using its one shared system-user token. [S1–S5, S8–S9]

There is a product tradeoff: a standalone Tech Provider requires each school to add its payment method in WhatsApp Manager. This contradicts the map's strict “one popup, no separate Business Manager steps” bar. A Tech Provider can partner with an existing Solution Partner to use the partner's credit line; becoming a Solution Partner itself is unnecessary and described by Meta as lengthy. **Choose billing/provider route before declaring the owner flow settled.** [S1, S4, S7]

Target **Embedded Signup v4**, not examples using v2/v3. Meta dates v4 to October 8, 2025 and warns that v2 is deprecated October 15, 2026, four days after this research. Its versions table also ends v3 availability in October 2026. [S10–S11]

## Evidence and confidence

- **Confirmed** means explicitly stated in the primary documents fetched below, not tested against Fillthemat's real Meta dashboard.
- **Recommendation/inference** is a proposed Fillthemat design or planning allowance, not a Meta guarantee.
- These are live documentation pages; most expose no last-updated date. Dates below are release/policy dates where the source provides them, not invented document modification dates.
- The business-verification Help Center page returned no readable body in two direct fetches. Its **14-business-day** timing was available in first-party search excerpts for that exact page and a second Help Center article. Treat that particular timing as excerpt-backed, not a full-page inspection. [S14]

## 1. Provider tier and three distinct verification gates

### Confirmed

1. A Tech Provider can independently deliver WhatsApp services, or jointly deliver them with a Solution Partner. Coexistence specifically requires an existing Solution Partner or Tech Provider. Tech Partner adds Meta Business Partner/accelerator participation; it is not necessary for this project. [S1–S2, S6]
2. Fillthemat needs a Meta app with the WhatsApp use case, connected to its business portfolio. The Tech Provider dashboard path is **Use cases → Customize WhatsApp → Tech Provider onboarding**. Facebook Login for Business requires a **Business-type app**. Inspect the existing app before deciding whether to reuse it; no source requires a separate app per school. [S2, S9]
3. **Business Verification** verifies Fillthemat as a business entity: legal business name, address, phone, email, website, proof of connection and possibly documents. The Tech Provider guide requires it **before starting App Review**. Only a business admin can complete it. This is not a paid Meta Verified subscription or an Official Business Account badge. [S2, S13]
4. **App Review** approves Advanced Access for the requested permissions so external schools can authorize access to their assets. App-role tests are not proof that external-school onboarding is approved. [S2–S3, S5]
5. **Access Verification** separately verifies that Fillthemat operates as a Tech Provider using other businesses' data. `whatsapp_business_management` is on the permissions list that requires it. Business Verification and an unrestricted business account are prerequisites. Requesting Advanced Access triggers the notification/form; the form is also in **Basics → Verifications → Access verification**. A business admin describes/categorizes the service and its use of client data. [S8]
6. Removing the app's business association, losing business verification, or business restrictions can invalidate verified Tech Provider status. Advanced-access apps also undergo ongoing compliance review. These are platform-wide health risks, distinct from an individual school's token. [S8–S9]
7. Embedded Signup normally allows 10 newly onboarded customers per rolling seven days; completing **Business Verification, App Review and Access Verification** raises that to 200. Fifty schools in a year does not justify a higher provider tier. [S4]

School-side business verification is a different question: Meta describes it as enabling increased messaging/phone limits and Official Business Account eligibility, not as the same universal prerequisite as verifying Fillthemat to serve other businesses. Schools need their own business portfolio, which can be selected or created inside Embedded Signup. Do not promise that every school is instantly eligible or never needs further verification. [S1, S4, S9]

## 2. Permissions and App Review submission

### Confirmed minimum for Cloud API

| Permission | Need and submission evidence |
| --- | --- |
| `whatsapp_business_messaging` — Advanced Access | Send/receive messages and statuses, media, phone operations. Written description of messaging for onboarded schools plus a separate recording showing a message sent and received in WhatsApp. |
| `whatsapp_business_management` — Advanced Access | School WABA metadata, templates, phone listing and webhook subscriptions. Written description of managing school assets plus a separate recording showing template creation. |

Meta explicitly permits the messaging demonstration through API Setup/cURL, and the template demonstration through WhatsApp Manager, instead of a finished owner-facing UI. Fillthemat can begin review before Embedded Signup is fully implemented. Request only needed permissions; unnecessary requests are a common rejection reason. Prepare basic app settings including icon, category and privacy policy. [S2–S3, S5]

### Other permissions: do not copy Phase 6's scope list blindly

- `business_management` is **not** in v4's required-permissions table for Cloud API. Meta says it is needed only for programmatic business-portfolio access. A Solution Partner needs it on its system token for credit-line sharing; BISU token-management APIs also require it. Add it only if an explicitly chosen endpoint/feature requires it, and seek the corresponding approval. The standalone Cloud API onboarding guide does not require it. [S4–S5, S7, S9–S10]
- Facebook Login for Business's general FAQ says **Advanced Access to `public_profile` is required before live external-user login**. Its page says `email` and `public_profile` are automatically granted, while the WhatsApp-specific v4 table lists only the two WhatsApp permissions. Include a dashboard check for the general login requirement rather than assuming two WhatsApp approvals alone satisfy every launch gate. These are Meta's documented layers, not an inference that email harvesting is necessary. [S9–S10]
- No ads, Pages, catalog, Marketing Messages, or Conversions API functionality is needed for this booking Assistant. Do not select those products/assets merely because v4 offers them. `whatsapp_business_manage_events` is not required for ordinary messaging/utility templates. [S3, S5, S10]

**Correction to Phase 6 §3.7/checklist:** App Review is not determined by whether a prospect messaging a number has an app role. It is determined by access to **other businesses' assets**. Meta explicitly says a direct developer accessing its own business data does not need App Review/Advanced Access; a provider serving school-owned WABAs does. Meta's test-number/role limitations must not be confused with permission approval for production client assets. [S3, S5]

## 3. Embedded Signup configuration and server completion

### Confirmed setup

1. Add Facebook Login for Business. Create a new **WhatsApp Embedded Signup** configuration selecting **Cloud API** and its WABA asset and two WhatsApp permissions. Product selection selects v4; capture the **configuration ID**. [S7, S10–S11]
2. Configure HTTPS hosting, allowed domains and valid OAuth redirect URIs for each test/production origin. Enable Client OAuth, Web OAuth, Enforce HTTPS, Embedded Browser OAuth, strict redirects and JavaScript SDK login as described by Meta. The local HTTP worktree origin is not a real Meta onboarding test origin. [S7]
3. Load the Facebook JS SDK; initialize with app ID and a currently supported Graph version. Launch `FB.login` from the Connect WhatsApp action with `config_id`, `response_type: 'code'` and `override_default_response_type: true`. The login config ID is not the Graph API version, nor a school credential. [S7, S9]
4. Enable the Business-app custom flow, identified as `whatsapp_business_app_onboarding`, and collect session logging. v4 explicitly supports it. Capture `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` plus the code from the SDK callback; handle cancel/error states too. [S6–S7, S10–S11]
5. Immediately exchange the code **server-to-server** at `GET /oauth/access_token` with app ID, app secret and code. Meta says the exchangeable code has a **30-second TTL**. Do not wait for history synchronization or manual operator action. [S7, S12]
6. With that school's business token, `POST /<WABA_ID>/subscribed_apps`. Coexistence **skips** the ordinary `POST /<PHONE_NUMBER_ID>/register` step: the number is already registered. Inspect `is_on_biz_app=true` and `platform_type=CLOUD_API` if needed to confirm coexistence. [S6, S12]
7. Configure app webhook fields `messages`, `message_template_status_update`, `account_update`, and coexistence fields **`history`, `smb_app_state_sync`, `smb_message_echoes`**. The app-level callback remains shared; subscribe it separately on each school's WABA. [S4, S6–S7]
8. Initiate contacts/history synchronization within **24 hours** after onboarding; Meta warns that missing the deadline requires offboarding and repeating signup. History sharing is the owner's choice; the API has a defined refusal event. History/contacts requests are one-shot for that onboarding. New owner-sent app messages produce `smb_message_echoes`. [S6]

### Documentation seam to validate, not conceal

The fetched coexistence page jumps from setup Step 1 to Step 3; its customization anchor has no rendered Step 2. The v4 guide says the custom flow remains enabled through `feature_type`, while the versions guide uses `featureType` for feature selection and says ordinary v4's extras object is intentionally empty. **Do not turn this note into an untested copy/paste SDK snippet.** Generate and exercise the coexistence variant using the current Embedded Signup Builder and v4 configuration; record the exact SDK options in the implementation spec. Session logging v3 is a payload version in old examples, not a reason to build on retiring Embedded Signup v3. [S6, S10–S11]

### Fillthemat design recommendations (inferences)

- Authenticate and authorize the School Owner, bind the attempt to the School and use a nonce/CSRF protection. Accept only exact trusted Meta message origins; do not copy a loose suffix-origin check into production.
- Treat browser-provided WABA/phone IDs as untrusted hints; validate granted assets and school mapping server-side using the resulting token. Handle absent IDs and partial completion before marking connected.
- Preserve separate **connection**, **health**, **owner enablement** and **public school approval/publish** states. A completed popup must not automatically enable the Assistant or stand in for billing/templates/readiness.
- Store and display history/echoes without generating Assistant turns or bookings from imported/owner-sent messages. The details belong with #132/#133, not this provider-prerequisite resolution.

## 4. Per-school credentials, lifetime and ownership

### Confirmed

- Embedded Signup authorizes Fillthemat against **school-owned assets**, not numbers placed under Fillthemat's shared WABA. A customer keeps WhatsApp Manager access; Fillthemat cannot restrict it. [S4]
- A BISU/business token is **scoped to an individual onboarded customer and explicitly delegated assets**, associated with the client's business portfolio, not an owner's personal account. It supports automated actions without ordinary user reauthentication. Use it for the school's messages, WABA/templates and subscriptions. A shared Fillthemat system token is not the Tech Provider replacement. [S4, S9, S12, S15]
- Meta's generic Login for Business comparison says BISU tokens **default to never expire**. But configurations choose expiration, and the current Embedded Signup implementation recommends a template explicitly named **“WhatsApp Embedded Signup Configuration With 60 Expiration Token.”** Therefore “all signup tokens are permanent” is unsafe. Choose the desired expiration configuration where offered and inspect the actual token's validity/expiry; do not silently assume the template issues a never-expiring token. [S7, S9]
- Clients can invalidate BISU tokens by removing the connected app in Business Settings. No-expiration does not mean non-revocable. Coexistence also disconnects on user action or device/app inactivity; `account_update` reports partner removal and other offboard/reconnect events. [S6, S9]
- Meta's permissions guide uses `debug_token` to inspect granted scopes and shows `is_valid`, `expires_at`, `data_access_expires_at` and app identity. Tokens are opaque variable-length strings; do not parse their internal structure or choose an arbitrary short length limit. [S5, S15]

### Recommended model (not a schema migration in this ticket)

Keep server-only encrypted credential storage keyed to a school's WhatsApp connection: business portfolio ID, WABA ID, phone-number ID, BISU token, actual expiry/validity metadata, granted scopes, onboarding/sync state and health. The app ID/secret, webhook HMAC secret and verify token remain common platform configuration; a public config ID is not a secret. Every outbound job/delivery must resolve the matching connection's token, with no fallback to another school's token.

“Per-school” is a Fillthemat mapping assumption, not Meta's exact token boundary: a customer portfolio may own multiple WABAs/numbers or operate multiple Schools. Decide whether multi-school owners share an installation; enforce school/asset authorization regardless. Never promise a token isolates one phone when it actually grants several assets. [S9, S15]

If the selected configuration expires in 60 days, implement a defined renewal/reconnect plan and notifications. Do not assume a standard refresh token exists: the fetched WhatsApp onboarding flow specifies code exchange, not a refresh-token grant. Generic BISU token-management endpoints exist and require `business_management`; verify their suitability and whether renewed owner authorization is necessary before adding that permission. [S9, S12]

## 5. Billing and the one-popup requirement

**Confirmed:** standalone Tech Providers/Tech Partners have no credit line. Their clients add their own payment method in **WhatsApp Manager**; Meta bills those clients for API usage. The onboarding guide explicitly instructs the provider to direct the customer to **WhatsApp Manager → Overview → Add payment method**. A Solution Partner shares its credit line and can bill clients; a Tech Provider can use a Multi-Partner Solution with one. [S1, S4, S12]

**Inference:** the minimum provider tier answers #131, but does not by itself meet #129's strict UX destination. Existing customer billing may remove this friction for some schools, not establish a general no-extra-step guarantee. Decide between (a) relaxing the payment-setup UX constraint, (b) partnering with a Solution Partner for credit-line billing, or (c) obtaining Solution Partner status later. Fees/credit-line responsibility are an onboarding dependency even if pricing schools remains out of scope. v4 public preview says functionality is identical to v4; its documented coexistence screens do not establish a new embedded payment-method solution. [S16]

## 6. Realistic timeline

| Work/gate | Meta's stated timing | Fillthemat planning implication |
| --- | --- | --- |
| Business Verification | Help Center first-party excerpts say up to **14 business days**. [S14] | Start legal-details/document preparation now; mismatches and requests for documents can extend the schedule. |
| App Review | WhatsApp review doc says about **24 hours average**, not an SLA. [S3] | Prepare two separate videos and written justifications while verification is pending; allow rejection/resubmission time. |
| Access Verification | Current guide says approximately **5 days**; launch announcement (2022-06-02) says **five business days**. [S8, S17] | Budget a working week, and distinguish this gate from App Review. |
| Engineering and real pilot | No Meta promise. | Build/test v4, token binding, school billing/templates, sync/echo/lifecycle handling in parallel with provider paperwork. |
| Individual school signup | Coexistence onboarding/sync can take **several minutes**, depending on history/network/webhook processing. [S6] | Minutes is a happy-path target after provider approvals, eligible account and billing readiness—not a guaranteed time to a healthy booking Channel. |

**Planning estimate/inference:** reserve roughly **4–6 calendar weeks** for a new, unverified Fillthemat business to reach an approved real pilot, with longer contingency for restrictions, document mismatch or review rework; this is not a quoted Meta end-to-end SLA or a full feature delivery estimate. Already-verified businesses can be faster. Partner selection/contracts for a credit-line route are additional unestimated dependencies. Do not promise launch in 24 hours by quoting App Review alone.

## 7. Concrete delta from the Phase 6 checklist

The following proposes the self-serve/coexistence **replacement checklist**, not edits to the current pilot runbook. #134 decides whether to retain the shared pilot alongside it.

| Existing Phase 6 item/section | Keep/change/add for school-owned coexistence |
| --- | --- |
| Code/migrations, #78 timestamp gate, Graph version, daily cron, bounded retries | **Keep** these correctness/runtime gates; provider onboarding does not replace them. Use a live Graph version; old sample `v21.0`/`v25.0` URLs are not prescriptions. |
| Meta app + WhatsApp use case (§3.1) | **Extend:** verify Business app compatibility; Tech Provider onboarding and Facebook Login for Business. |
| Business portfolio “verification if required” (§3.2) | **Replace:** verified Fillthemat portfolio is mandatory for this external-school route; add independent Access Verification and restriction checks. |
| Shared WABA + pilot number; manual IDs (§3.3) | **Replace:** school selects/creates its portfolio/WABA and authorizes its existing Business-app number through v4; validate/bind assets server-side. Do not `/register` a coexistence number. |
| Admin System User + permanent global token on Vercel (§2, §3.4) | **Replace for school operations:** BISU per customer installation, encrypted storage, real expiry/revocation handling, tenant-bound worker/sender credentials. Common app/verify/signing configuration remains. |
| Fillthemat-owned shared templates (§3.5) | **Replace:** submit/track templates on each school's WABA; keep registry names/body-variable contract and approval gate for no-email/out-of-window sends. “Connected” must not imply approved templates. |
| Webhook + `messages`/template status (§3.6) | **Keep** HTTPS, HMAC, verification, dedupe/status handling. **Add** per-WABA subscription, `account_update`, history/contacts/owner echoes and their routing; begin one-shot sync within 24h. |
| App Review “if non-role users will write in” (§3.7/checklist) | **Correct:** Advanced Access for other schools' assets is mandatory before external-school self-service, independent of prospects' role status; include login launch-gate checks. |
| Setting IDs is the toggle; optional small settings task (§0/§8) | **Replace:** a real owner-authorized connection workflow plus explicit enable/disable and health. This is not a small form exposing identifiers. Keep `approvedAt` + `publishedAt` gate. |
| No billing item | **Add a blocking decision:** own payment method in WhatsApp Manager versus a Solution Partner credit line. |
| Staging/prod leads-first, bookings-second acceptance (§4–§5) | **Keep and extend:** real eligible US Business-app pilot, profile/number retained, owner reply echoed and Assistant handoff safe, template delivery, expired/revoked connection fails closed, disconnect/reconnect, cross-school isolation. Sandbox numbers cannot send/receive; sandbox popup success is insufficient. [S4] |
| Second school = new phone ID, same WABA (§5/checklist) | **Replace:** second external school completes its own authorization/credential/billing/template readiness flow. |
| Per-school WABAs and Embedded Signup are non-goals (§3.3/§7) | **Explicitly supersede for this initiative**, retaining that statement only if the historical shared-number pilot still ships separately. |

## 8. Open decisions for the map (do not create tickets in this research pass)

1. **New urgent question: billing/provider route compatible with one-popup UX.** Standalone Tech Provider is sufficient technically but does not guarantee the stated owner experience. Decide whether to partner or relax the bar before #135's prototype hardens.
2. **New lifecycle/credential question:** chosen token expiration, renewal path, revocation/inactivity detection and owner notifications. #130 establishes vendor behavior; a product/runtime response is still unspecific. Include multi-school portfolios and asset-scoped authorization.
3. **New per-school template provisioning/readiness question:** automate submission/status handling and define pending/rejected states before booking confirmation is promised. Already listed as fog in #129; make it explicit work.
4. **Mis-scoped #135:** current published/Business-app prechecks and “connected” mock are not enough; add billing/templates/sync readiness and unhealthy/reconnect states. A completed popup is not equivalent to a live Channel.
5. **Clarify #134:** school ownership is of customer assets; Meta authorizes an installation at portfolio/asset scope, not necessarily one WABA for every Fillthemat School. Also decide whether the existing shared pilot remains; don't present self-serve as a human-only Phase 6 change.
6. **Implementation validation seam:** confirm v4 coexistence SDK options and actual token expiry in the current Builder/dashboard. This can be a narrow spike/acceptance gate rather than more broad documentation research.

## Primary source register

All sources checked 2026-10-11. Unless stated otherwise, no last-updated date was exposed. Forum posts and third-party explanations were not used as authoritative evidence.

- **S1 — Partner tiers, billing, verification:** https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/overview
- **S2 — Become a Tech Provider:** https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers
- **S3 — WhatsApp App Review, evidence, timing, direct-developer distinction:** https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/app-review
- **S4 — Embedded Signup overview, ownership, limits, billing, sandbox:** https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview
- **S5 — WhatsApp permissions and `debug_token`:** https://developers.facebook.com/documentation/business-messaging/whatsapp/permissions
- **S6 — Business-app coexistence requirements, onboarding exception, sync and lifecycle:** https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users
- **S7 — Embedded Signup implementation, config, HTTPS, 30-second code TTL:** https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation
- **S8 — Access Verification, separate gate and approximate five-day timing:** https://developers.facebook.com/documentation/development/release/access-verification
- **S9 — Facebook Login for Business, BISU expiration/configuration/revocation and general `public_profile` FAQ:** https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business
- **S10 — v4, required assets/scopes and custom coexistence:** https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-4 — release date **2025-10-08**, updated as additional products are supported.
- **S11 — Embedded Signup versions and deprecation:** https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/versions — v4 release **2025-10-08**; public preview **2026-05-12**; v2 warning **2026-10-15**.
- **S12 — Tech Provider post-signup API/billing steps:** https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider
- **S13 — Business Verification:** https://developers.facebook.com/documentation/development/release/business-verification — notes Advanced Access business-verification policy as of **2023-02-01**.
- **S14 — Verification timing, first-party search excerpts only:** https://www.facebook.com/business/help/2058515294227817 and https://www.facebook.com/business/help/863987813384785 — excerpts say **up to 14 business days**; body inaccessible during this pass.
- **S15 — Access token guide, token type and opaque storage:** https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens
- **S16 — v4 public preview, coexistence screens, functionality parity:** https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-4-public-preview
- **S17 — Access Verification launch announcement:** https://developers.facebook.com/blog/post/2022/06/02/access-verification-process-for-tech-provider-apps/ — published **2022-06-02**, says typically **five business days**; used to contextualize, not override S8's current guide.
