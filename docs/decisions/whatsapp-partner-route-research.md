# Research: Fillthemat-paid WhatsApp partner route

**Research date:** 2026-10-12 (requested decision date). **Status:** research recommendation, not a purchased service, implementation, or Meta approval.
**Issue:** [#140](https://github.com/fillthemat/fillthemat/issues/140), for [#129](https://github.com/fillthemat/fillthemat/issues/129). No parent issue body or application code changed.
**Method:** primary-source documentation and repository inspection. No vendor contact, number purchase, OTP request, live Embedded Signup, or credit attachment was performed. Source publication/effective dates are recorded below; undated pages are not assumed to have been published on the research date.

## Recommendation

**Use 360dialog Partner-Paid, Fillthemat-hosted Embedded Signup v4, and pre-verified Fillthemat-bought US numbers as the conditional planning baseline.** Fillthemat still becomes a Meta Tech Provider; 360dialog is the Solution Partner and invoices Fillthemat for the platform, channels and WhatsApp usage. This is the best documented combination found for the settled owner experience: school-owned business identity, one authorization popup, no school payment method, and number verification handled before the owner enters the flow. The combined experience is documented in parts, not experimentally proved here. [M1–M4, D1–D4]

This is a recommendation to the parent session, **not owner acceptance of a vendor contract or budget**. Make a real first-school v4 pilot and a written commercial confirmation launch gates. At 50 active numbers, the published lowest regular-channel plan costs **$1,740/month plus number rental and usage**, materially more than Twilio at low traffic. The extra cost buys documented preverification and a Meta-shaped messaging interface rather than Twilio's first-number OTP handoff and larger transport rewrite. [D2–D6, T1, T3]

**Direct Meta Cloud API plus a credit-only Solution Partner would be architecturally preferable if a partner actually sells it on acceptable terms.** Meta explicitly supports giving messaging permission to only one partner while another provides billing. But that mechanism is not a public credit-only offer from Twilio, 360dialog, Infobip or Vonage. Do not choose a fictional zero-markup product to avoid rewriting code. Ask 360dialog/Infobip for that option before committing; if a written offer and pilot prove it, reconsider the transport recommendation. [M1, M2, I1, V1]

**Do not use Twilio's documented default flow without changing #163's number-verification promise.** Its current v4 guide requires Fillthemat to receive and relay the first number's OTP for the School Owner to enter in Embedded Signup. Automatic verification applies to later SMS-capable senders in the same customer WABA, not to the first number for each of 50 schools. [T1]

## Settled requirements and earlier research

- [#163](https://github.com/fillthemat/fillthemat/issues/163#issuecomment-6116327048): each School owns its WhatsApp account, authorizes once in Embedded Signup, receives a new number Fillthemat buys; Fillthemat pays. Existing-number coexistence is out of scope.
- [#131](https://github.com/fillthemat/fillthemat/issues/131#issuecomment-6115702511): Tech Provider verification/reviews, v4, customer-scoped credentials, and approximately 4–6 weeks of setup planning remain relevant. Its coexistence-specific sync and skip-registration advice does **not** apply to these new numbers. Standalone Tech Provider billing requiring the school's payment method is precisely what a Solution Partner must replace.
- [#145](https://github.com/fillthemat/fillthemat/issues/145#issuecomment-6115980526): number purchase/OTP reception APIs and carrier rental estimates survive. Its shared Fillthemat-portfolio 50-number cap/allowance assumptions do not carry over to separate school portfolios. Number deletion/release and carrier inactivity still need route-specific validation.
- [#152](https://github.com/fillthemat/fillthemat/issues/152#issuecomment-6116274370): a school-specific Assistant is allowed in principle, not written Meta approval; give prospects a direct human contact route and do not train shared models on WhatsApp chats. School branding does not make unrelated schools sharing Fillthemat's old WABA acceptable.
- [#129](https://github.com/fillthemat/fillthemat/issues/129) also settles cold inbound texts, read-only Conversation auditing, and Off → 30-day cooling-off with a fixed reply → release. This research does not reopen those choices or promise that final cleanup is human-free.

## 1. These are transport/billing choices, not alternative Meta programs

Both routes use **Fillthemat as Tech Provider + an approved Solution Partner + an Active Multi-Partner Solution**. The useful distinction is who sends messages and handles account/number operations:

| Question | Partner messaging service: Twilio | Partner messaging service: 360dialog | Direct Meta messaging + partner credit |
| --- | --- | --- | --- |
| Meta authorization | Fillthemat's popup includes its Twilio Solution ID; owner authorizes both partners. [T1, M1] | Fillthemat's own popup includes its 360dialog solution; approved Tech Provider and Active solution required. [D3, M1] | Fillthemat hosts the popup with the credit partner's Solution ID. Owner authorizes the school assets to both. [M1] |
| School identity | Customer-owned school assets; dedicated Twilio subaccount per customer WABA. [T1] | School assets with one provider client/channel allocation per School. [D3, M5] | School-owned identity, delegated customer credentials; carrier account is independent of Meta ownership. [M1, M5] |
| Who pays Meta? | Twilio provides partner billing; all child-account usage charges hit Fillthemat's main-account balance. [M1, T2] | Solution Partner billing; Partner-Paid invoices Fillthemat for plan, channels, messaging and calls using a shared balance. [D1] | Solution Partner is Meta's Bill To Party and liable for linked spend; it must contract to invoice Fillthemat, not Schools. [M2] |
| School payment method | Not needed on this ISV/main-account model; Fillthemat funds its account. [M1, T2] | Not needed on **Partner-Paid**. **Direct-Paid fails** the requirement. [D1] | Not needed if partner credit is successfully attached; this is not achieved merely by obtaining Tech Provider status. [M1, M2] |
| New US number | API-buy an SMS/voice-capable DID in the school subaccount; configure carrier reception before signup. [T1, T4] | Fillthemat buys a DID from Twilio/Telnyx, receives OTP, and uses 360dialog's preverification APIs before signup. [D4, T4, prior #145] | Buy carrier DID ourselves; partner must expose preverification or validate current v4 post-authorization addition/verification. [M3, M4] |
| First-number OTP | Owner enters the code Fillthemat relays in the first popup. Later senders can be automated. [T1] | Backend requests/receives/submits the OTP first; owner selects a pre-verified number with no OTP entry. [D4] | Meta preverification requires **Solution Partner** eligibility, not just our Tech Provider status. Partner must operate/share the pool. [M3] |
| Registration | Twilio Senders API v2 after signup; one WABA maps to one account/subaccount. [T1, T5] | Submit claimed phone ID to 360dialog; **360dialog registers it**, then channel-live event and channel API key. [D3, D4] | Backend/partner registers and subscribes assets; require funding verification before live. [M1–M4] |
| Sending/webhooks | Twilio Messaging API, Twilio message IDs and callbacks; not direct Graph transport. [T1, T6] | 360dialog Messaging API, Meta-shaped JSON and `wamid` IDs; provider webhook authentication. [D5, D6] | Existing Graph API/HMAC payloads can remain; add per-customer tokens, subscriptions, billing/lifecycle handling. [M1, M2] |
| Public availability | Documented self-service ISV integration plus support-assisted solution setup. [T1] | Documented Partner-Paid and API-led custom signup/preverification. [D1–D4] | Meta mechanism confirmed; purchasable credit-only commercial terms **not established** by reviewed vendor docs. [M1, M2] |

Twilio's default **1,000 subaccounts** comfortably supports 50 Schools; their balance is shared, not a separate wallet the owner must fund. Subaccounts isolate resources, not Fillthemat's financial liability or all suspension risk. [T2] Neither route requires one Meta app or deployment per School. Shared app/webhook infrastructure is compatible with separate school identity. [M1]

### Is the owner's whole Meta interaction one popup?

**Eligible-owner happy path: yes, with partner-funded billing. Lifetime guarantee: no.** The owner logs in with Facebook, selects/creates the school's business assets, confirms truthful details and terms, and grants partner access. Both partner names are disclosed; we cannot hide the billing partner. No separate payment screen is needed when credit is attached by the partner. 360dialog preverification removes the number OTP step; Twilio's default first-number flow does not. [M1–M4, D3, D4, T1]

This is several screens **inside one popup**, not one click. An owner without a usable Facebook login/admin authority, with restricted assets, or needing identity documents can need work outside it. Revocation, token expiry/reconnect, additional business verification or compliance appeals can require future Meta interaction. The product can promise that owners do not routinely manage Meta billing/numbers, not that Meta can never ask them to act again. [T1, I1, prior #131]

360dialog-hosted Integrated Onboarding is another option, but includes the provider's hosted experience. Prefer Fillthemat-hosted signup for the specified settings → Meta popup → settings experience; prove its redirects and absence of provider account/payment prompts in the pilot rather than assuming the hosted and custom flows look identical. [D3, D4]

### Preverification and v4 documentation traps

1. Meta's preverified object is **temporary**. Persist it separately from the real claimed `phone_number_id`; signup replaces the object. Numbers unclaimed after 90 days need reverification; claimed numbers must be registered within 90 days. Do not buy a year of inventory and assume the pool stays ready. [M3, D4]
2. Meta's generic bypass page still documents `only_waba_sharing`. Twilio's October 9 guide says v4 removed it; 360dialog's current guide also says the old feature is retired/replaced. **Do not build around that old snippet.** Use the new v4 Login for Business configuration and pilot preverified-number selection. [M4, M6, T1, D3]
3. Meta's own preverification requirements say approved Solution Partner. Being a Tech Provider does not entitle Fillthemat to create that pool directly. 360dialog publishes partner-key APIs for it; a credit-only partner must provide an equivalent arrangement. [M3, D4]
4. 360dialog's preverification page still contains a v2 example, despite its signup page recommending v4. Treat the pool/API mechanism as documented and the exact combined v4 launch options as a **pilot gate**, not production-ready copy/paste. [D3, D4]
5. The `preverified_number_claimed` provider event is documented as **single attempt, no retry**. Reconcile API state as well as consuming callbacks; an absent event must not trigger a second number purchase. [D4]

## 2. Costs at approximately 50 US schools

These are USD list-price calculations, not a quote. Exclude taxes, discounts, optional calling/add-ons, carrier OTP usage and operational labor. Meta prices by **recipient market/category**, not the US area code of the school's rented number. School-owned portfolios do not automatically pool all 50 schools' Meta volume discounts. [M7]

### Number rental is separate from WhatsApp billing

- Twilio US local DID: **$1.15/month**, or **$57.50/month for 50**; toll-free $2.15/month. Inbound local SMS for OTP reception lists $0.0083/segment before carrier fees. [T3]
- Earlier #145 checked Telnyx's starting **$1/month + $0.10 SMS/MMS capability**: approximately $55/month for 50. This is inherited research, not a new guaranteed US inventory quote. Both providers need actual Meta OTP delivery testing and confirmation that WhatsApp-only carrier inactivity will not cause reclamation.
- Buying a Twilio DID **does not** impose Twilio's WhatsApp per-message fee when WhatsApp messages go through Meta or 360dialog. Carrier rental/reception and WhatsApp transport are separate products. [T1, T3, T4]
- WhatsApp-only use is not an outbound SMS campaign. Adding SMS fallback would introduce separate 10DLC/consent requirements; do not add it as an OTP workaround. See #145's cited carrier findings.

### Messaging and platform fees

| Route | Published provider charge | At 50 regular school channels, before Meta usage |
| --- | --- | --- |
| Twilio Programmable Messaging | **$0.005 per inbound or outbound WhatsApp message**, plus Meta charges; failed-message fee $0.001 where applicable. No separate per-channel monthly fee is specified on this pricing page. [T6] | $57.50 DID rental + $0.005 × total messages; e.g. 100,000 aggregate monthly messages → **$557.50**, before Meta/extras. |
| 360dialog Starter | $300/month includes 5 regular channels; extra channels $59/month. [D2] | $300 + 45 × $59 = **$2,955**, plus $57.50 using Twilio DIDs. |
| 360dialog Growth | $600/month includes 10; extra channels $30/month. [D2] | $600 + 40 × $30 = **$1,800**, plus rental. |
| 360dialog Premium | $1,200/month includes 20; extra regular channels $18/month. [D2] | $1,200 + 30 × $18 = **$1,740**, plus rental: **$1,797.50**. |
| Direct Meta + credit-only partner | Meta fees + carrier rental + **unknown partner commercial fee/minimum/deposit**. [M1, M2] | Cannot give an honest all-in figure without a quote. Do not substitute 360dialog's channel fee or assume zero. |

360dialog Partner-Paid also charges **4% on usage-related card payments/top-ups**; bank transfer has bank charges. This is not documented as 4% on every platform subscription invoice. At 5 active schools the Starter platform total is $300 (not $59 × 5); at 50 Premium is cheapest of the published regular-channel plans. These channel licences do not purchase the carrier DIDs. [D1, D2]

**Illustrative crossover:** $1,740 / $0.005 = **348,000 aggregate inbound + outbound messages/month**, around 6,960 per School at 50. Below that, Twilio's provider fee is lower than 360dialog's fixed fee; above it, 360dialog's fixed overhead is lower, assuming comparable Meta pass-through. This is arithmetic, not a forecast of Fillthemat traffic, and excludes discounts, processing fees and implementation effort.

### Important current pricing contradiction — obtain written confirmation

Meta's retrieved pricing guide says ordinary non-template service replies are **free** inside the 24-hour window, as are utility templates delivered inside it; billable templates are charged on delivery. Twilio's current calculator/CSV lists US utility/authentication at **$0.0034**, but its prose and CSV Service column suggest service charges; its calculator simultaneously says in-window utility is free. 360dialog's current pricing prose also says service messages are billed. These provider statements conflict with Meta's ordinary-business pricing guide and #152's classification. [M7, T6, T7, D2]

**Planning basis:** use Meta's ordinary-business rules, label the US $0.0034 utility/authentication rate as the provider-published pass-through estimate, and do **not** assert that every provider invoice will exclude service fees. Ask each shortlisted partner to confirm the applicable service/utility-window and AI classification charges in writing. A general-purpose AI rate is not permission to offer a US general-purpose Assistant. [M7, prior #152]

Example under those assumptions: 50 Schools × 100 delivered out-of-window US utility templates = 5,000 × $0.0034 = **$17 Meta usage**. Twilio adds $0.005 for all its inbound/outbound messages, even ones Meta does not charge. A hypothetical $0.0034 provider service pass-through on 100,000 outbound service replies would add $340; this is a sensitivity check, **not a confirmed charge**. No marketing campaign spend is assumed; Twilio's US row marks marketing unavailable. [T6, T7]

## 3. Setup, reviews and time to a live School

**No chosen partner removes Fillthemat's Meta reviews.** Carry forward #131's Business Verification, App Review/Advanced Access to `whatsapp_business_management` and `whatsapp_business_messaging`, and Access Verification. Submit actual template-creation and send/receive evidence. 360dialog additionally documents `public_profile` Advanced Access for its self-hosted flow. Keep scopes route-specific; credit-sharing finance APIs belong to the Solution Partner and require its authority, not our universal entitlement. [M1, M2, M6, D3, T1]

| Gate | Documented timing and planning interpretation |
| --- | --- |
| Fillthemat Business Verification | Twilio says it can take **several weeks**. Infobip quotes usually 2–5 business days. Different provider estimates are not a Meta SLA. [T1, I1] |
| App Review | Earlier #131 quotes Meta average ~24h; Infobip says usually 3–5 business days. Allow for evidence preparation, rejection and resubmission. [I1, prior #131] |
| Access Verification | Twilio says typically **5 business days**; Infobip approximately 5 days. [T1, I1] |
| Partner activation | Twilio requests an approved/live app, support ticket and **1–2 business days** to send the solution request. Acceptance/technical completion follow. 360dialog requires an Active solution; no reliable full activation SLA found. Credit-only negotiation has no public SLA. [T1, D3, M1] |
| First live School | Owner authorization, number claim/registration, funding, API key/webhook setup and template readiness are separate gates. 360dialog says custom templates can take up to 24h; that is a provider estimate, not guaranteed end-to-end live time. [D3, D7] |

**Planning inference:** retain approximately **4–6 calendar weeks** from an unverified Fillthemat business to an approved pilot, with longer contingency for review and contracts. Do not promise an instant first-school launch when the popup closes. School-side verification/higher limits are different from Fillthemat's reviews. [prior #131, T1, I1]

Twilio's current guide requires a **new Meta app**, rather than reusing the existing one. Infobip recommends a new one unless an existing app has already completed the Tech Provider process. 360dialog only establishes an approved app/Active solution requirement in the reviewed page. Confirm existing-app reuse before rewriting the Phase 6 operator instructions. [T1, I1, D3]

## 4. What changes in the existing code?

This is repository analysis at branch base `4396c3f`, not code changes. The existing worker/business logic is reusable on every route; provider-specific transport assumptions are not.

| Existing component | Direct Graph + partner credit | Recommended 360dialog service | Twilio service |
| --- | --- | --- | --- |
| `src/lib/whatsapp/client.ts` | Keep Graph payloads, IDs and errors. Its injectable token is already a seam, but production must resolve the correct customer's credential instead of the global fallback. | Keep most text/template/interactive JSON builders and `wamid` response semantics. Replace URL with provider `/messages`, use channel `D360-API-KEY`, normalize provider errors. Retest receipts/typing; not all fields are proved by the send schema. [D5] | Replace Graph sender with Twilio Messaging API; normalize message SID, error codes and Twilio template/interactive mapping. Existing Graph error 131047 handling cannot simply be assumed to survive. [T6, T8] |
| `src/lib/whatsapp/config.ts` | Shared Meta app secrets remain; global `WHATSAPP_SYSTEM_USER_TOKEN` no longer authorizes every school by assumption. | Separate Meta app/signup config from provider platform secret, partner key and per-channel messaging keys. [D3, D5, D6] | Add account/subaccount credentials, sender IDs, signup config and Solution ID. [T1] |
| `src/app/api/webhooks/whatsapp/route.ts` | Keep Meta challenge/HMAC. Subscribe each school Messaging Account and handle funding/access/account updates. [M1, M2, M5] | Messaging payloads remain Meta-shaped; replace messaging trust check with `x-360dialog-signature` and platform secret. Provider validation is optional in its docs; require it in Fillthemat and pilot actual signed delivery. Add separately authenticated partner lifecycle callbacks (custom secret headers are documented); do not assume every lifecycle event carries the messaging signature. Meta signup/control events may still use Meta HMAC. [D3, D6, D8] | New Twilio signature validation and inbound/status adapters; carrier SMS OTP is a separate endpoint from WhatsApp messages. Meta app control events remain separate. [T1, T8] |
| `src/lib/whatsapp/parse.ts`, `status.ts` | Largely reusable; test newer account IDs/events. | Largely reusable after captured-fixture verification; provider control events require separate parsing. [D8] | Twilio-specific form/callback parsing and normalized status/interactive values replace the current Meta adapters. [T8] |
| `src/lib/whatsapp/templates.ts` | Keep content registry; create/approve each school's templates through Graph. | Keep content/components; create/status APIs under `/v1/configs/templates`, per channel/account. [D7] | Keep business content, map to Twilio Content API/Content SIDs and approval resources per subaccount. [T9] |
| `src/lib/whatsapp/worker.ts`, Conversation/job/booking logic | Reuse school routing, retries and Assistant/Booking Intent/Lead Request logic. | Same, behind provider-normalized sends/statuses and allocation-aware credentials. | Same; replace wire transport, not the Assistant's business responsibilities. |
| `docs/whatsapp-plan.md` D9 and `docs/whatsapp-phase6-kickoff.md` | Replace shared WABA/global-token/shared-template setup. | Replace it with per-school identity, client/channel/API-key/funding/template readiness and provider webhooks. | Also replace transport smoke tests/fixtures/credentials and introduce first-number OTP relay. |

Do **not** throw away the queue, transactional booking confirmation, deduplication, retry policy, opt-out/window logic or read-only audit history merely because the sender changes. Keep immutable School/number-allocation attribution across cancellation, cooling-off, reconnect and DID release; delayed callbacks must not be attributed by today's E.164 assignment alone. These are engineering recommendations derived from existing code and #145, not vendor guarantees.

### New account-model split: plan identifiers, do not expand scope

Meta's primary account-model guide is **beta**, released May 1, 2026: client-owned WhatsApp identity/number (**WAAC**) is separated from a Messaging Account containing templates, billing and webhook subscriptions. A Messaging Account may be partner-owned; this does not make the school's business identity Fillthemat-owned. Legacy WABA IDs keep their value and become Messaging Account IDs. Templates are isolated per Messaging Account. [M5]

Meta gives Phase 1 H2 2026, Phase 2 H1 2027 and mandatory transition H1 2028. 360dialog's page, reviewed October 8, says automatic migration completes by mid-October 2026 and existing APIs remain compatible through H1 2028. **Use Meta's phased/beta timeline as authority; do not claim all Fillthemat accounts have migrated already or that no H1 2028 work is needed.** Some generic account/pricing wording still references the old model. [M5, D9]

For #134/#143, persist the signup `waba_id` as the provider's current messaging/template/billing identifier, separately from `phone_number_id`, carrier DID ID, provider client/channel ID and eventual WAAC ID. Do not substitute one for another. Single-responder, fresh school numbers need no multi-integration thread-control feature now. Future Graph version work may require `messaging_account_id` and WAAC-path changes; this is not a reason to rebuild the present transport prematurely. [M5]

For any credit-only offer, additionally prove **which Messaging Account Fillthemat's sending app charges**. Meta's new model associates billing with the sending app's Messaging Account and says a client-owned Messaging Account with attached partner credit cannot be shared with another partner. Do not infer from the legacy credit-sharing endpoints that every new-model app/account combination works; have the partner demonstrate funding and invoice attribution on the actual rollout. [M1, M2, M5]

## 5. Other partners checked

- **Infobip:** its official integration guide explicitly says Infobip bills **the Tech Provider** for end-client API usage, and documents a Multi-Partner Solution, resource association and registration callbacks. Its advanced-options page offers preverified numbers through an account manager. It is a credible alternative if a quote beats 360dialog, but no sufficiently precise US number price/platform fee or API-only rented-DID preverification offer was established here. Its documented solution grants messaging to Infobip and routes traffic through Infobip APIs, **not credit-only direct Graph**. [I1, I2]
- **Vonage:** official hosted signup supports approved Tech Providers, accepted Solution IDs and optional per-client subaccount API keys; Channel Manager is beta. Subsequent sending uses Vonage Messages API. The reviewed page does not establish Fillthemat-only billing, zero-owner-OTP first-number onboarding or credit-only pricing, so it is not a better evidenced choice. [V1]

These are bounded findings about the reviewed offerings, not claims that the vendors cannot negotiate other arrangements. No commercial request was sent.

## 6. Launch gates and newly exposed open questions

1. **Commercial confirmation:** accept the 360dialog fixed-cost budget, or obtain a better Infobip/credit-only quote. Confirm USD Partner-Paid, all client charges billed only to Fillthemat, deposits/minimums, service/utility-window fees, AI classification, plan upgrades and suspension behavior. Closing the research issue does not authorize spending.
2. **Real v4 first-number pilot:** prove Fillthemat-hosted popup + preverified rented US number + no owner OTP/payment/provider account prompt + correct school ownership + channel-live/API key. Resolve stale v2/bypass examples with the selected partner before implementation.
3. **Failure/authorization gates:** prove exact admin/terms/cancellation/reconnect experience, token/key revocation/rotation and account restrictions. Eligible-owner one-popup success is not evidence of a permanent no-Meta-action guarantee.
4. **Funding isolation and controls:** confirm credit attachment, observe shared balance, establish low-balance alarms/spend limits and stop sending when funding is uncertain. A successful signup/registration event alone is not readiness. Partner credit removal/unsharing can block messaging. [M2]
5. **Cooling-off and cleanup:** validate how the partner supports final school-owned-number removal. #145 found Manager/admin deletion and a 30-day no-paid-message condition; do not assume a provider's channel-cancel API deletes Meta assets or releases the carrier DID. Fixed replies may affect the last-paid-message date if provider service charges apply. Reconcile #151's 30-day release promise with actual rules before promising autonomous cleanup.
6. **Policy confirmation:** obtain partner/use-case confirmation of school-specific booking service, direct school phone/email escalation, privacy/opt-out enforcement and inference-vendor no-training settings. Keep the scope bounded as #152 requires.

### Implications for the parent map

- **#134:** do not first ship a shared-WABA multi-school pilot known to violate the settled ownership decision. Pilot the selected per-school route; retain all runtime/security/retry/booking gates. Replace D9 and runbook global credentials/shared templates, but reuse worker and business logic. Decide the ADR in that issue, not in this research branch.
- **#143:** automate each school Messaging Account's template creation/status monitoring on the selected API, not one manually approved shared registry. Account/number/funding readiness and required template approval must gate Live; creation API success is not approval. 360dialog's custom-template estimate is up to 24h, not an SLA. Retest template category changes, failure and paused/disabled behavior there. [D7, D8, M5]
- **#135:** prototype preparing/preverifying the number before popup launch, one disclosed partner-authorizing Meta popup, cancellation/retry and setup success/failure, then number/profile/wa.me/QR sharing. No billing screen or owner OTP in the recommended happy path. Do not expose Live on popup completion alone; account for cooling-off/re-enable and exceptional reconnect/help without adding an owner-facing forest of internal states.

## Sources and dates

Primary sources retrieved during this research session; **2026-10-12 is the requested research record date**, not a manufactured publication date. Modification dates were not exposed unless noted. Earlier #131/#145/#152 evidence is linked above with its own checked dates.

- **M1 — Meta, Multi-Partner Solutions:** <https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/multi-partner-solutions>. Messaging-permission selection, partner disclosure, client asset access, credit lines and 200 new clients/rolling week. Undated retrieved page.
- **M2 — Meta, Managing credit lines:** <https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/share-and-revoke-credit-lines>. Solution Partner liability, attach/verify/revoke APIs; alternate attachment method marked testing, including non-changeable attached credit-line warning. Undated.
- **M3 — Meta, Pre-verified phone numbers:** <https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/pre-verified-numbers>. Solution Partner eligibility, pool sharing, temporary/claimed IDs and 90-day windows. Undated; example still includes v2.
- **M4 — Meta, Bypassing phone number addition:** <https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/bypass-phone-addition>. Legacy `only_waba_sharing` mechanism; compare newer vendor v4 instructions, do not copy blindly. Undated.
- **M5 — Meta, Account-model evolution:** <https://developers.facebook.com/documentation/business-messaging/whatsapp/account-model-evolution/>. Released **2026-05-01**, explicitly beta; Phase 1 H2 2026 / Phase 2 H1 2027 / Phase 3 H1 2028.
- **M6 — Meta, Embedded Signup v4:** <https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-4>. Release **2025-10-08**; v2 deprecation **2026-10-15**; new Login for Business configuration and Advanced Access product permissions.
- **M7 — Meta, Pricing:** <https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing>. Per-delivered-template model effective **2025-07-01**; retrieved current-card heading says July 1, 2026 while October 1 updates remain under a future-labelled section. Ordinary in-window service/utility free; portfolio volume aggregation. Resolve actual current invoice/rate-card with partner.
- **T1 — Twilio, Tech Provider integration guide:** <https://www.twilio.com/docs/whatsapp/isv/tech-provider-program/integration-guide>. Metadata modified **2026-10-09**; first-sender owner OTP, per-client subaccounts, new-app requirement, reviews and 1–2-day solution request.
- **T2 — Twilio, Subaccounts:** <https://www.twilio.com/docs/iam/api/subaccounts>. Parent billing/shared balance and default 1,000-subaccount limit; undated here.
- **T3 — Twilio, US SMS/number pricing:** <https://www.twilio.com/en-us/sms/pricing/us>. Page says pricing current **October 2026**; $1.15 local / $2.15 toll-free monthly, $0.0083 inbound local SMS/segment before extras.
- **T4 — Twilio, IncomingPhoneNumber resource:** <https://www.twilio.com/docs/phone-numbers/api/incomingphonenumber-resource>. Purchase, capabilities and carrier webhook configuration; #145 recorded modification **2026-05-04**.
- **T5 — Twilio, Senders API:** <https://www.twilio.com/docs/whatsapp/api/senders>. Metadata modified **2026-10-07**; `/v2/Channels/Senders`, v1 deprecated **2026-09-01**.
- **T6 — Twilio, WhatsApp pricing:** <https://www.twilio.com/en-us/whatsapp/pricing>. Page says current **September 2026**; $0.005 inbound/outbound, failed-message fees; inconsistent service/in-window prose noted above.
- **T7 — Twilio, downloadable WhatsApp rate CSV:** <https://www.twilio.com/content/dam/twilio-com/pricing-data/en/WhatsAppPricing-pricing-details.csv>. Undated retrieved CSV; US utility/authentication/service columns $0.0034, marketing `x`. Service column conflicts with Meta's ordinary pricing.
- **T8 — Twilio, Messaging webhook requests:** <https://www.twilio.com/docs/messaging/guides/webhook-request>. Incoming SMS/WhatsApp request fields; #145 recorded modification **2026-03-09**. Twilio callback transport is not Meta JSON/HMAC.
- **T9 — Twilio, Content API:** <https://www.twilio.com/docs/content/overview>. Linked from T1; template-builder/API model, not Graph template sending. No modification date recorded.
- **D1 — 360dialog, Billing models:** <https://docs.360dialog.com/partner/get-started/billing-models>. Explicit Partner-Paid versus Direct-Paid responsibility. Undated.
- **D2 — 360dialog, Partner pricing:** <https://docs.360dialog.com/partner/get-started/pricing>. Plan quotas/rates, regular-channel fee, usage-card 4%; service-charge prose conflicts with M7. Undated.
- **D3 — 360dialog, Partner-hosted Embedded Signup:** <https://docs.360dialog.com/partner/onboarding/partner-hosted-embedded-signup>. Tech Provider/Active solution/public_profile requirement, v4 configuration, client/channel linking, live/key flow and provider registration responsibility. Discusses retirement **2026-10-15**; no modification date exposed.
- **D4 — 360dialog, Preverified numbers:** <https://docs.360dialog.com/partner/resources/pre-verified-phone-numbers>. Partner-key API pool/request/verify flow, signup integration, expiry and single-attempt claim webhook. Undated.
- **D5 — 360dialog, Messaging API messages:** <https://docs.360dialog.com/docs/messaging-api/api-reference/messages>. Retrieved OpenAPI **1.50.8**, `https://waba-v2.360dialog.io/messages`, `D360-API-KEY`, Meta-shaped payloads and response IDs. Undated.
- **D6 — 360dialog, Signature validation:** <https://docs.360dialog.com/partner/onboarding/webhook-events-and-setup/signature-validation>. HMAC-SHA256 platform-secret validation, `x-360dialog-signature`, messaging event scope and replay deduplication. Undated.
- **D7 — 360dialog, Create a message template:** <https://docs.360dialog.com/partner/get-started/quickstarts/create-a-message-template>. Create/list `/v1/configs/templates`, approval states, up-to-24h custom estimate. Undated.
- **D8 — 360dialog, Send a message:** <https://docs.360dialog.com/partner/get-started/quickstarts/send-a-message>. Approved-template requirement, `wamid` responses, Meta-shaped sent/delivered/read/failed payloads. Undated.
- **D9 — 360dialog, New WhatsApp account model:** <https://docs.360dialog.com/partner/onboarding/new-whatsapp-account-model>. **Last reviewed 2026-10-08**; mid-October migration claim. More specific than Meta's beta overview; do not treat as proven rollout for our accounts.
- **I1 — Infobip, Tech Provider setup/integration:** <https://www.infobip.com/docs/whatsapp/tech-provider-program/setup-and-integration>. Explicit provider-billed usage, Meta reviews, partner messaging permission and Infobip APIs. Undated.
- **I2 — Infobip, Advanced options:** <https://www.infobip.com/docs/whatsapp/tech-provider-program/advanced-options>. Preverified number availability via account manager; no numeric US price/quote in retrieved page. Undated.
- **V1 — Vonage, Hosted Embedded Signup:** <https://developer.vonage.com/en/channel-manager/guides/whatsapp/hosted-es-flow>. Live app/accepted solution/full-control requirements, optional subaccount API key, beta Channel Manager and Messages API linking. Undated; legacy OBO references mean it is not authoritative for current ownership rules.
