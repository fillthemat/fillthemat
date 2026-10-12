# Research: API provisioning of school WhatsApp numbers

**Status:** research resolution for [#145](https://github.com/fillthemat/fillthemat/issues/145); not an implementation or a replacement tenancy decision.
**Date:** 2026-10-11. Primary sources checked on this date; source dates below are publication/modification or effective dates where exposed, not promises of continued availability.
**Scope:** Fillthemat buys US numbers when a School Owner enables WhatsApp; one Fillthemat-owned Meta app and WABA, one `phone_number_id` per school, school-branded profiles, approximately 50 schools within 12 months. This is the D9 architecture in `docs/whatsapp-plan.md`.
**Method:** documentation research only. No live number purchase, OTP request, Meta permission test, or registration was performed. Consequently, “documented API” is not “proven for Fillthemat's production account.”

## Verdict

**Conditional yes for the mechanical provisioning happy path; no for an unconditional, human-free lifecycle.** Number purchase, OTP request/submission, number creation, display-name submission/change, profile configuration, and Cloud API registration all have documented API mechanisms. Meta approval, account eligibility, OTP delivery, and capacity cannot be guaranteed by those calls. WABA number deletion explicitly requires an admin in WhatsApp Manager. [M1–M7, P1–P4]

Two architecture gates precede a promise of “Enable WhatsApp → school-branded number”: **Meta acceptance of the publicly evidenced Fillthemat–school relationship** and **capacity above the default 20-number portfolio cap**. Neither a standalone school name nor 50-number approval is established by the public docs. [M1, M6, P5]

## 1. Buy a number and obtain Meta's verification code

### Confirmed provider mechanisms

| Provider | Purchase and configure | Receive the code programmatically | Caveat |
| --- | --- | --- | --- |
| Twilio | Search `AvailablePhoneNumbers`, then `POST /2010-04-01/Accounts/{AccountSid}/IncomingPhoneNumbers.json`; set `SmsUrl` and `VoiceUrl` on creation or update. Capabilities report SMS/voice availability. [P1] | Incoming SMS webhook includes `Body`, `From`, `To`, and `MessageSid`; the SID also supports REST retrieval. [P2] | SMS capability establishes a receive mechanism, not guaranteed Meta OTP delivery. Twilio's automatic OTP handling in its **Senders API** is a different integration from buying a DID for direct Meta Cloud API. [P6] |
| Telnyx | Search `GET /v2/available_phone_numbers`, then `POST /v2/number_orders`; wait for success/activation. Orders can require regulatory information and review. [P3] | A messaging-profile webhook delivers `message.received` with `payload.text`. Voice can be answered/recorded with TeXML `<Record>`; recording and transcription callbacks expose audio/text. [P4, P7] | Voice transcription is an engineering building block, not a Meta-certified OTP parser or delivery guarantee. |

Meta requires an owned number with country/area code and SMS or voice reception. Its number-type table marks **VoIP SMS OTP “Not Recommended” and voice OTP “Standard”**, subject to international reception and provisioning settings. Short codes are unsupported. Banned numbers require an appeal; numbers already used with WhatsApp need the applicable deletion/migration path. [M1]

**Inference/recommendation:** buy a US local DID with both SMS and voice, configure reception before requesting the code, try the validated delivery method, and keep bounded fallback/operator handling. A voice route should capture the call directly, not require menu navigation: Meta's registration call cannot navigate an IVR. An inability to receive the call can require a Direct Support ticket/allowlist and human or mailbox routing. [M1] Do not confuse receiving Meta's OTP with using Twilio Verify/Telnyx Verify to generate our own OTP.

**Not proven:** end-to-end Meta OTP reception for either provider on the exact number class/account Fillthemat will use. Make a paid, authorized pilot test an implementation gate, rather than treating inventory's SMS flag as proof.

## 2. Add, verify, brand, and register: API versus Manager

These are Graph endpoint shapes, not runnable app commands. Use a supported, pinned API version (the current examples use v25.0).

| Step | Documented mechanism | Is Manager inherently required? |
| --- | --- | --- |
| Create the number in the WABA and submit initial name | `POST /{WABA_ID}/phone_numbers` with `cc`, `phone_number`, `verified_name`; persist returned ID. [M2, M3] | No in the documented programmatic flow; account access must be validated. |
| Request ownership code | `POST /{PHONE_NUMBER_ID}/request_code` with `code_method=SMS|VOICE` and language. [M1, M2] | No. The code arrives through the carrier, not in the Graph response. |
| Submit ownership code | `POST /{PHONE_NUMBER_ID}/verify_code` with the received code. [M1, M2] | No if reception/parsing succeeds. |
| Register for Cloud API | `POST /{PHONE_NUMBER_ID}/register` with `messaging_product=whatsapp` and a six-digit two-step PIN. [M2, M4] | **API required**; adding/verifying in Manager is not Cloud API registration. |
| Set school profile | `POST /{PHONE_NUMBER_ID}/whatsapp_business_profile` with address, about, description, email, websites, vertical, uploaded picture handle as applicable. [M7] | No. |
| Change display name | `POST /{PHONE_NUMBER_ID}` with `new_display_name`; observe `new_name_status`/name-update webhook; re-register **after approval**, within 14 days. Up to 10 changes per 30 days. [M5] | No for ordinary accounts. Official Business Accounts require Direct Support for name changes. |
| Observe readiness | Read `status`, `code_verification_status`, `verified_name`, name status where available; subscribe to account/name/capability events. [M1, M5, M8] | No for supported fields; Manager is an operator fallback. |
| Suspend Cloud API use | `POST /{PHONE_NUMBER_ID}/deregister`. Does not delete the number or message history. [M4] | No for this non-coexistence architecture. |
| Delete number from WABA | Portfolio admin deletes in WhatsApp Manager; PIN required when Connected; no paid messages in preceding 30 days. [M1] | **Yes. Meta explicitly says no API deletion.** |

### Access prerequisites and documentation differences

The generic registration guide tells direct developers to add/verify through Manager; the solution-provider guide explicitly documents all four programmatic steps and bulk repetition. The current phone-number API reference also exposes the create endpoint. Therefore, the generic guide is **not evidence that addition and verification are universally UI-only**, but the provider guide alone is **not proof of Fillthemat's entitlement**. Validate `POST /{WABA_ID}/phone_numbers` on Fillthemat's app/WABA before building the owner promise. [M2–M4]

Use a production system-user token, appropriate WABA asset access, and `whatsapp_business_management`/`whatsapp_business_messaging` permissions. Meta's permissions guide says a direct developer accessing only its own business data does not require App Review/Advanced Access; accessing other businesses' WABAs does require Advanced Access, and partner client access requires App Review. The creation reference nevertheless lists “appropriate permissions and app review completion” generically. This documentation mismatch is a reason to test the actual entitlement, not to assert all shared-WABA deployments need App Review or that they never do. **Whether this customer-facing shared-WABA service is accepted as an own-business/direct-developer use case remains a Meta confirmation gate.** [M3, M9]

Humans still establish the business portfolio/app/WABA, prove legal identity/authority where verification requires it, configure billing/access, and handle reviews/support exceptions. Those are platform setup/compliance prerequisites, not a requirement that each School Owner open Manager. [M9, M10, M11]

Twilio's WhatsApp Senders API is not a shortcut to the existing direct-Cloud-API transport: its direct-customer guide requires first-sender Self Sign-up in the Console and sends ISVs to the Tech Provider onboarding path. It automates verification for Twilio SMS numbers **inside that Twilio integration**. Switching to it would be a separate provider/onboarding decision; do not copy its sender status/limits into Meta's current shared-portfolio model. [P6]

## 3. School display names in Fillthemat's WABA

**Confirmed rules:** names must accurately represent the business/service/product/department, comply with messaging/commerce policies, and have a clear relationship to the business's legal name and external branding. Meta explicitly allows agency/distributor/partner/parent-company cases **when the relationship with the represented end-client business is evident on the business website**. When a brand/company relationship is unclear, its guideline recommends “by [company name]”; its examples also require the association to be publicly stated. [M6]

**Application/inference:** “Kaizen BJJ” is not forbidden merely because the WABA legal business is Fillthemat, but **approval is conditional, not assured**. A private contract or internal school row is not the documented public evidence. Publish truthful, permissioned pages identifying Kaizen BJJ and its Fillthemat-powered booking/WhatsApp service; ideally have the school corroborate the relationship. “Kaizen BJJ by Fillthemat” is a candidate to test if the relationship needs clarification, not a guaranteed approval or permission to invent ownership. [M6]

Confirmed rejection examples include an unrelated/unsubstantiated combined brand; generic terms or geography alone; “Official”/“Verified”; Meta/WhatsApp/Facebook references; promotional offers/superlatives; website/email-formatted names; names absent from external branding; and prohibited-business content. [M6]

### Review, timing, and launch readiness

- Meta says **initial display-name review is not required to start using the platform**. Initial review becomes eligible when the business qualifies for higher messaging limits; its developer guide describes automatic verification when reaching a higher limit. Approval affects whether the name can appear in the chat header/list, not merely the profile. The `verified_name` string by itself does **not** mean approval. [M5, M12]
- Changes after initiating review require approval before the updated name can be used; approval/rejection arrives via `phone_number_name_update`, with API status fields documented. The general phone-number guide still calls `name_status` beta/not universal, while the newer display-name guide presents it directly. Use webhooks plus operator reconciliation; validate field access. [M1, M5, M12]
- **No universal display-name review SLA was found in the inspected primary sources.** Do not promise “instant,” “24 hours,” or a fixed number of days. A review-eligible/pending state can stall; a number not yet eligible is not necessarily a review already in progress. The 14-day re-registration window and 10-per-30-day edit rule are not review-duration estimates. [M5, M12]
- A rejection requires corrected name/public evidence, resubmission, or a developer/support appeal; API submission cannot force approval. Twilio warns rejection can limit or disconnect a sender in its onboarding flow; do not infer every direct-Cloud sender has that precise behavior. [M5, P6]

**Product choice still open:** Meta may allow technical messaging before name approval, but Fillthemat must decide whether to expose a school number/QR then. Keep **transport Connected**, **name eligibility/review**, and **owner-facing Live** separate; “Live with approved school branding” must not be inferred from a successful registration call.

## 4. Capacity, messaging limits, and quality

### Number capacity: portfolio, not 50 free slots per WABA

Current Meta docs: a new **business portfolio** starts at **2 registered numbers**; business verification **or reaching a 2,000 messaging limit** automatically raises the cap to **20**. `business_capability_update` reports `max_phone_numbers_per_business`. Twilio confirms the unverified 2-number restriction is across all WABAs and directs higher-cap requests to Meta Direct Support, or Twilio support when using Twilio. [M1, P5]

**Implication:** business verification does not automatically grant 50 school numbers. Obtain a support-approved cap of at least 50 plus agreed operational headroom, and check current capacity before buying. Public docs inspected do not establish a universal verified **per-WABA** cap independent of that portfolio cap, an automatic path from 20 to 50, a guaranteed maximum, or a support SLA. Creating more WABAs in the same portfolio does not remove its aggregate cap. [M1, P5]

### Messaging: new number shares the existing portfolio's allowance

The current limit is **unique WhatsApp recipients reached outside the customer-service window in a moving 24 hours**, shared by every number in the portfolio. A **new portfolio** starts at **250**, then 2,000 after an approved scaling path, then 10,000, 100,000, unlimited by automatic scaling. A new school number in an already scaled portfolio does **not** receive an independent fresh 250/1,000 allowance. One school can consume the shared allowance. [M8]

Business verification, partner verification, or 2,000 high-quality delivered out-of-window messages to unique recipients in 30 days are scaling paths; Meta analyzes quality and can deny/defer escalation. After the 2,000 tier, high quality across numbers/templates and at least half the current limit used in the last seven days allow one-tier escalation within six hours. `messaging_limit_tier` is deprecated; read `whatsapp_business_manager_messaging_limit`. These allowance rules are distinct from in-window replies and transport rate limits. [M8]

Per-number default Cloud throughput is **80 messages/second**, inbound plus outbound, all types; eligible high-volume numbers can upgrade automatically to 1,000. WABA/pair limits still apply. [M13]

Quality is still **per number**: Green/high, Yellow/medium, Red/low, based on recipient feedback (blocks/reports) over the last seven days. The API can return unknown/NA for numbers without an established rating; do not promise every new number starts Green. Meta's quality Help Center says the old **Flagged/Restricted phone statuses were discontinued October 7, 2025**, although generic reference enums still list them. Follow current quality/account events rather than rebuilding obsolete per-number tier/status logic. [M1, M14]

**Recommendation/inference:** #141 needs school-local health plus portfolio-wide capacity/allowance, and fairness/admission decisions. Healthy school numbers are not isolated from other schools' use or portfolio restrictions.

## 5. Costs and US registration

| Item | Documented cost / requirement |
| --- | --- |
| Twilio local US number | **From $1.15/month**; capabilities/type affect price. Approximately $57.50/month for 50 at that starting rate, before usage/tax/extras. [P8] |
| Telnyx local number | **From $1/month**, plus **$0.10/month for SMS/MMS capability** on the inspected price card: roughly $50 voice-only or $55 SMS-enabled for 50 at starting rates. Confirm actual US inventory pricing; advertised volume discounts start above 50 purchases/month, not automatically at exactly 50 schools acquired over a year. [P9] |
| OTP delivery/reception | Carrier SMS or inbound voice, recording/transcription and other configured features can add usage fees. The DID rental is not an all-in WhatsApp price. [P8–P10] |
| Direct Meta WhatsApp | Public Cloud pricing specifies **delivered template-message fees**, not a per-number rental/registration fee. Non-template messages in an open 24-hour customer-service window and utility templates in that window are free under ordinary-business pricing. Rates depend on recipient market/category, not the school DID area code. No separate Meta per-number fee is specified in the inspected schedule. [M11] |
| A2P 10DLC | Twilio explicitly says A2P registration has **no impact on WhatsApp**. A WhatsApp-only DID receiving Meta OTPs does not become an outbound SMS campaign. If we add outbound US SMS/MMS (including an SMS fallback/auto-reply), separately register that traffic and account for campaign/carrier fees. [P11] |

This answers 10DLC scope, not a claim that all US telecom/account requirements disappear. Provider identity/payment/account restrictions and any inventory-specific regulatory information still apply; Telnyx documents pending/rejected requirement states. [P1, P3, P10] Choose local numbers for the initial pilot; toll-free SMS has separate verification requirements and is not a way to bypass OTP delivery issues. [M1, P11]

Pricing dates: Meta switched to delivered-message billing July 1, 2025; its inspected page describes July 1, 2026 cards and October 1, 2026 updates (some “future” labels are stale on the research date). Telnyx's price page exposes `dateModified=2026-07-16`. Use current account/rate cards for an actual budget, not this starting-rate estimate.

## 6. Switch off, delete, release, and reuse

**Confirmed:** deregistration is an API call that makes the number unusable with Cloud API but **does not delete the number or history**. WABA deletion requires a portfolio admin in Manager, the Connected number's PIN, and no paid messages during the preceding **30 days**. Turning off two-step verification also requires Manager/email; it cannot be done by API. [M1, M4]

Provider release is automatable: Twilio `DELETE .../IncomingPhoneNumbers/{Sid}.json` releases the DID; Telnyx `DELETE /v2/phone_numbers/{id}` removes it from the account, subject to any deletion lock. Twilio reserves a released number for the account for **10 days**, then moves it into testing/recycling; restoration produces a new Phone Number SID and restarts monthly billing. It is not a permanent reservation. No equivalent guaranteed Telnyx reclaim/recycling interval was established by the inspected deletion docs. [P1, P12–P14]

**Recommended sequence (product/engineering policy, not an implemented workflow):**

1. Immediately disable the school's WhatsApp Channel and remove public links/QR promotion; suppress/fence queued sends and inbound Assistant processing for that allocation.
2. Keep the DID rented and ownership/PIN secure during any retention, transfer, or deletion waiting period. Optionally deregister through the API; verify success rather than assuming “off” removed the WABA association.
3. Have a Fillthemat admin delete the number in Manager when eligible; keep a retryable cleanup task if the last paid message is less than 30 days old.
4. Confirm Meta deletion before releasing the provider number. Provider release alone does not perform Meta deregistration/deletion.
5. Retain historical school/allocation linkage according to the application's privacy/retention policy, not according to DID rental or Meta history availability.

**Reuse risks/inference:** a released DID may become someone else's, so old wa.me links, saved contacts, printed QR codes, and prospect expectations can direct school traffic to its next holder. Provider recycling tests do not prove the number has never had a WhatsApp account/ban. Number ownership and new `phone_number_id`/provider IDs are not consent to reuse old conversations or bookings for another school. Never reassign an old allocation's transcript/lead history by E.164 alone; use immutable school/allocation identity and fence delayed callbacks/jobs. Re-enabling after final release cannot promise the same number. [M1, M4, P12–P14]

**Additional retention gate:** Twilio warns it may reclaim inactive DIDs; its general activity examples are three completed calls of at least 12 seconds or three SMS messages per month, with no universal country rule. **Inference:** school traffic sent directly through Meta Cloud API may not appear as carrier voice/SMS usage, so paying rental alone is not documented assurance against reclamation. Obtain the provider's WhatsApp-only/inactivity policy and arrange legitimate retention before launch; do not add an outbound SMS “keepalive” without considering 10DLC and consent. Telnyx's corresponding retention guarantee is also unconfirmed here. [P14, P11]

**Outstanding product choice:** does “Off” retain the number (and rental), start permanent deletion/release, or offer an owner-authorized transfer? Immediate suspension and final release need different states and copy.

## 7. Human gates and unresolved implementation questions

| Gate | What remains human or unproven |
| --- | --- |
| Meta/provider setup | Legal identity, authority, billing, token/asset setup and any requested documents; no proof the real account has the programmatic creation entitlement. [M3, M9, P3] |
| Shared-WABA eligibility and branding | Confirm the multi-school service is accepted under this ownership model; pilot a truthful public relationship/name. API acceptance alone is not policy approval. [M6, M9] |
| 50-school scale | Support-approved portfolio number cap above 20; no guaranteed acceptance or timing. [M1, P5] |
| OTP failure / recycled numbers | Delivery/voice parser test, retries, conflicts, bans/appeals, support exceptions. [M1, P1–P7] |
| Carrier inactivity | Confirm the selected provider will retain WhatsApp-only DIDs even when Meta traffic bypasses its voice/SMS APIs. [P14] |
| Name review rejection/stall | Correct external evidence/name or appeal; define operational timeout without inventing a Meta SLA. [M5, M6, M12] |
| Permanent cleanup | Admin deletion in Manager and 30-day paid-message condition; secure PIN; provider release afterward. [M1, M4] |
| AI policy classification | Meta's 2026 policy restricts **general-purpose AI assistants** to markets where legally required. Fillthemat's school-specific booking Assistant is not obviously that product, but this research does not establish exemption or Meta's classification. Confirm it remains ordinary business customer service, not an AI-provider offering, before rollout. [M15] |

This resolves the research question while leaving empirical/policy acceptance and product choices open. No additional issues were created and no parent map was edited.

## Scope implications for the map

- **#141 — provisioning/stall states:** persist purchase/OTP/registration state separately from name eligibility/review and owner-facing Live; include capacity-blocked, review-rejected, support-required, and cleanup-waiting/manual-cleanup states. Track per-number quality **and shared portfolio** limits. Bounded retries must respect Meta's 10 registration/deregistration requests per number per 72 hours. Public name evidence and actual create-endpoint/OTP tests are launch gates. [M4]
- **#135 — Enable WhatsApp prototype:** no instant-approval promise; distinguish “setting up,” “waiting/not yet eligible for branding review,” “needs help,” and “ready.” Decide whether QR/link sharing is allowed before approved branding. Explain what Off does, whether number rental continues, and whether the same number can be recovered. The School Owner need not personally operate Manager when Fillthemat owns the assets; Fillthemat handles operator exceptions.
- **#146 — conversation audit:** no live-reply scope added. Read-only transcripts need immutable school/channel/allocation attribution across deactivation, re-enabling, transfer, and DID reuse; retain lead/booking linkage independently of provider IDs and current settings. App transcript retention remains a product/privacy decision; Meta deregistration does not erase history, and the 30-day paid-message deletion rule is **not** a transcript-retention rule.

## Primary-source register

All accessed 2026-10-11. Meta developer pages and Help Center articles did not expose reliable modification dates in the inspected content unless an effective date is noted. Help Center pages were read in a browser because ordinary HTTP fetching returned empty/login content. Generic API schemas and provider examples can lag current limits; specific current policy/limits guides take precedence in this note.

- **M1:** Meta, [Business phone numbers](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers): eligibility, OTP types, portfolio cap, code APIs, name-status availability, deletion and PIN rules.
- **M2:** Meta, [Registering business phone numbers (solution providers)](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/registering-phone-numbers): four-step API/bulk flow. Also warns Embedded Signup v2 retires **2026-10-15**; any fallback/new client-owned onboarding should use the current v4 flow.
- **M3:** Meta, [Phone Number Management API](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/phone-number-management-api): creation/listing/reference prerequisites; contains legacy messaging-tier enums.
- **M4:** Meta, [Register a business phone number](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/registration): register/deregister, PIN, 10 requests/72 hours, deregistration versus deletion.
- **M5:** Meta, [Display names](https://developers.facebook.com/documentation/business-messaging/whatsapp/display-names): eligibility, API updates/status, approval webhook and re-registration.
- **M6:** Meta Business Help Center, [Display name guidelines](https://www.facebook.com/business/help/757569725593362): represented-business relationships, public evidence and rejection examples.
- **M7:** Meta, [Business profiles](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-profiles): profile fields and API updates.
- **M8:** Meta, [Messaging limits](https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits): portfolio-shared 250/2,000/10,000/100,000/unlimited tiers, scaling and field deprecation.
- **M9:** Meta, [Permissions](https://developers.facebook.com/documentation/business-messaging/whatsapp/permissions): own-data versus other-business App Review/Advanced Access and token permissions.
- **M10:** Meta Business Help Center, [How to change your display name](https://www.facebook.com/business/help/378834799515077): prerequisites, review and official-account support path.
- **M11:** Meta, [Pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing): per-message billing effective **2025-07-01**, free in-window service/utility messages, rates/billing.
- **M12:** Meta Business Help Center, [About WhatsApp Business display name](https://www.facebook.com/business/help/338047025165344): initial review not necessary to start; later review eligibility; distinction from official-account status.
- **M13:** Meta, [Throughput](https://developers.facebook.com/documentation/business-messaging/whatsapp/throughput): 80/1,000 mps, qualification and rate limits.
- **M14:** Meta Business Help Center, [Phone number quality rating](https://www.facebook.com/business/help/896873687365001): seven-day feedback, rating colors, shared messaging limits, Flagged/Restricted discontinuation **2025-10-07**.
- **M15:** Meta, [AI Provider policy/pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/ai-providers): terms effective **2026-01-15**, pricing effective **2026-02-16**, market updates **2026-05-12**. Classification is not resolved by this research.
- **P1:** Twilio, [IncomingPhoneNumber resource](https://www.twilio.com/docs/phone-numbers/api/incomingphonenumber-resource), modified **2026-05-04**: search/purchase, capabilities, webhook fields, delete/release.
- **P2:** Twilio, [Incoming-message webhook](https://www.twilio.com/docs/messaging/guides/webhook-request), modified **2026-03-09**: SMS text and API retrieval identifiers.
- **P3:** Telnyx, [Number orders](https://developers.telnyx.com/docs/numbers/phone-numbers/number-orders): inventory search, purchase, activation/regulatory states.
- **P4:** Telnyx, [Receive SMS/MMS](https://developers.telnyx.com/docs/messaging/messages/receive-message): messaging-profile setup and webhook body.
- **P5:** Twilio, [Error 63104: phone-number capacity](https://www.twilio.com/docs/api/errors/63104), modified **2026-10-08**: unverified cross-WABA cap, support escalation.
- **P6:** Twilio, [Register senders using API](https://www.twilio.com/docs/whatsapp/register-senders-using-api), modified **2026-09-25**: initial Console signup, ISV distinction, SMS automatic verification, voice handling and rejection warning.
- **P7:** Telnyx, [TeXML Record](https://developers.telnyx.com/docs/voice/programmable-voice/texml-verbs/record): recording/transcription callbacks.
- **P8:** Twilio, [Phone numbers](https://www.twilio.com/en-us/phone-numbers): US local starting rental and usage distinction.
- **P9:** Telnyx, [Global numbers pricing](https://telnyx.com/pricing/numbers/au), modified **2026-07-16** in page metadata: $1 local starting rental, $0.10 SMS/MMS addition, volume conditions. This accessible locale route presents the global/USD card and canonical `/pricing/numbers`; the query-string route returned 404.
- **P10:** Telnyx, [Pricing guidance](https://developers.telnyx.com/pricing): voice/platform/feature usage and account-specific rate caveats; representative voice rates checked **2026-09-16**.
- **P11:** Twilio, [A2P 10DLC in Conversations](https://www.twilio.com/docs/conversations-classic/a2p-10dlc-conversations), modified **2026-06-25**: expressly excludes WhatsApp; outbound US SMS/MMS scope.
- **P12:** Telnyx, [Delete a phone number](https://developers.telnyx.com/api-reference/phone-number-configurations/delete-a-phone-number): release endpoint and deletion lock.
- **P13:** Twilio Help Center, [Restore a released number](https://help.twilio.com/articles/223183108-Restoring-a-previously-released-phone-number): 10-day reservation/recovery, new SID and billing on restoration.
- **P14:** Twilio, [Phone-number best practices](https://www.twilio.com/docs/phone-numbers/best-practices), modified **2026-07-07**: inactivity/reclamation risk, release by API/Console, no release fee, 10-day restoration window.
