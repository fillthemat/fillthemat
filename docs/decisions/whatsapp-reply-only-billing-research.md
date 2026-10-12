# Research: reply-only WhatsApp without billing or a Solution Partner

**Research date:** 2026-10-12 (the requested decision date). **Issue:** [Reply-only billing](https://github.com/fillthemat/fillthemat/issues/166), child of [the onboarding map](https://github.com/fillthemat/fillthemat/issues/129).
**Status:** documentation research, not a live account test, implementation, vendor commitment or Meta approval. Branch starts at `origin/main`, `26e3b4b`. No parent-map body, app code, environment or Meta configuration was changed.

## Verdict

**(c) The proposed no-payment-method/no-partner setup does not have a supported production route in the reviewed docs.** More specifically, **(b) standalone Tech Provider works if the school adds a payment method**, but that breaks the settled requirement that Fillthemat pays and the owner only completes the popup. A Solution Partner's credit line remains the documented way to meet that requirement without a school payment method. [S3–S6]

The crucial new finding is Meta's **October 1, 2026 pricing change**: its dedicated non-template pricing page explicitly announces charges for ordinary service replies **and utility templates inside the 24-hour window**. Its current service-message guide also says service messages are billed. The general pricing page, marketing website, AI-provider page and Help Center excerpt still say these replies are free. This is a genuine first-party documentation conflict, not just a vendor markup discrepancy. For planning on October 12, prefer the specific dated change over undated old/free prose, and require actual delivery-pricing evidence or written Meta confirmation before promising otherwise. [S1–S3, S7, S15–S16]

**Confirmed documentation, not confirmed runtime:** the October 1 announcement and mandatory billing instructions are explicit. Whether every particular account has received that rollout, and its exact current US rate, were not tested. An apparently successful send on a test number, an app-role account or a historically free account does not establish a supported no-billing route for all new school customers.

## Prior work used, rather than repeated

- [Tech Provider prerequisites](https://github.com/fillthemat/fillthemat/issues/131#issuecomment-6115702511) and `origin/research/meta-tech-provider:docs/decisions/meta-tech-provider-research.md`: retain provider verification/reviews, Advanced Access, customer-scoped credentials, v4 and per-school subscription/readiness. Its payment-method warning remains relevant; coexistence-specific exceptions do not apply to new numbers.
- [Partner-route research](https://github.com/fillthemat/fillthemat/issues/140#issuecomment-6116395738) and `origin/research/whatsapp-partner-route:docs/decisions/whatsapp-partner-route-research.md`: retain the conditional vendor comparison, carrier/messaging separation and first-number OTP differences. The October 1 Meta announcement plausibly explains the service-rate columns previously flagged as contradictory; it does not prove a vendor's actual invoice or a credit-only offer.
- [AI/account policy](https://github.com/fillthemat/fillthemat/issues/152#issuecomment-6116274370): school-specific booking support remains the use-case interpretation, not general-purpose AI access; separate school ownership, a direct human contact route and no shared-model training remain required.
- [School-owned account decision](https://github.com/fillthemat/fillthemat/issues/163#issuecomment-6116327048): one Meta authorization popup, a Fillthemat-bought number, and Fillthemat paying are standing constraints, not choices this research reopens.

## 1. Can an unfunded school account send in-window replies and utility templates?

### What Meta explicitly says

| Source | Explicit statement | Consequence |
| --- | --- | --- |
| General pricing [S1] | Per-delivered-template pricing from July 1, 2025; all non-template messages and in-window utility templates free. Service conversations free from November 1, 2024. | Establishes the old/free model, but conflicts with the dated change below. |
| Non-template pricing update [S2] | Effective **October 1, 2026**, service messages and in-window utility messages are charged per message. Service includes both human and third-party-AI responses. | Never initiating a conversation does **not** ensure zero Meta fees. |
| Current service-message guide [S3] | “Service messages are billed under the SERVICE pricing category.” | Independently supports planning for charged replies, without relying only on an “upcoming” page. |
| Embedded Signup overview [S4] | Without a Solution Partner, the customer “must first attach a payment method ... before they can begin messaging”; billing must be set up before sending. | No documented reply-only exception to standalone customer onboarding. |
| Tech Provider onboarding [S5] | Register number (step 3), optionally test an inbound-initiated text reply (step 4), then instruct customer to add payment method (step 5); fully onboarded after payment setup. | Registration and even a test response are not the same as completed production readiness. |
| New-model Messaging Account guide [S6] | If `primary_funding_id` is absent, the account has no payment method and **cannot send paid messages**. | Missing funding blocks the messages now announced as paid. |

Search's **first-party excerpt** of S2 additionally says: “For any Solution Provider or directly-integrated businesses that does not have a payment method on file by September 30, 2026, Meta will stop delivering service messages ... October 1, 2026.” The fetched Markdown body of that same URL did not contain this sentence; treat that exact cutoff wording as **excerpt-backed**, not full-body corroboration. The full body does independently contain the effective date, charge rules and billable-service webhook example. [S2]

**Answer:** do not promise either free text replies or free in-window booking-confirmation templates on an unfunded account today. Under the specific October 1 rules they are paid messages, which an unfunded Messaging Account cannot send. Historical/limited testing may work; it is not a documented durable onboarding alternative. [S2–S6]

### Caps and other restrictions: distinguish funding from verification

- **250 is not an in-window reply cap.** Newly created portfolios start at 250 unique recipients per moving 24 hours **outside** customer service windows, shared across the portfolio's numbers. Reply-only use does not consume that stated outside-window allowance. Higher tiers require verification or qualified high-quality outside-window traffic. This does not exempt replies from billing. [S8]
- Normal Cloud API throughput is **80 inbound plus outbound messages/second per registered number**, with separate account/pair limits and quality constraints. There is no stated special no-card throughput allowance in this guide. [S9]
- Templates require `APPROVED` status even when used inside the window; quality feedback can pause or disable them. Unverified portfolios allow **250 templates per WABA**, versus up to 6,000 with verification and an approved display name; creation is capped at 100/hour per WABA. These are verification/template limits, **not no-payment-method limits**. [S10]
- The reviewed onboarding docs put registration before payment setup and do **not** explicitly say a missing payment method prevents OTP verification, number registration or template creation. Nor do they guarantee all those operations for every unfunded/restricted account. There is no primary-source basis here for inventing a special no-card template quota, free-message quota, or permanent “trial mode.” [S4–S5, S10–S12]
- The 72-hour **free entry point** exception remains for eligible Click-to-WhatsApp ads/Facebook Page CTA entries, with its required response timing. An ordinary cold text, wa.me link or QR scan is not documented as that exception. It cannot satisfy the map's “cold texts must work” requirement; ads have their own costs, and signup still documents billing readiness. [S1–S2, S4]

## 2. Is adding a payment method mandatory, and is it part of the popup?

**Mandatory for the documented standalone Tech Provider production route; not a mandatory screen inside the default popup.** The distinction matters: the owner can finish authentication/asset creation/authorization in Embedded Signup while still being incompletely onboarded for production messaging. Meta then directs them to **WhatsApp Manager → Overview → Add payment method**. The standard v4 screen list has no payment-entry screen; skipping a screen is not a billing exemption. [S4–S5, S11]

The partner-tier comparison explicitly says Tech Provider customers cannot bypass payment-method collection; Solution Partners extend a credit line to remove client payment entry. Partnering with one does not require Fillthemat itself to become a Solution Partner. [S7]

**What the docs do not say:** no reviewed source says “reply-only Tech Provider customers can permanently skip step 5,” or that Fillthemat can API-attach its own card to unrelated school accounts as an ordinary Tech Provider. Do not replace the partner with an undocumented shared-card automation. Whether a real account permits a temporary test without payment is a narrower factual question, not an answer to the intended customer journey.

## 3. Is anything in-window charged in the US? What about AI and confirmation categories?

Under the dated October 1 announcement: [S2]

| Message | Classification / charge |
| --- | --- |
| Assistant's ordinary text/interactive reply | **Service**, billed per delivered message, even within 24 hours. Human replies have the same message category; AI is not the reason for this service charge. |
| Approved non-promotional confirmation of the requested trial booking | **Utility** is the appropriate category inference, but **charged inside the window** from October 1. Actual assigned category, not our registry/type name, governs. |
| Authentication template | Paid template even in-window, outside the eligible free-entry exception; not used to confirm a booking. |
| Marketing template | Normally paid even in-window, but **Meta currently does not deliver marketing templates to US recipient numbers**. A confirmation recategorized as marketing may fail rather than merely cost more. [S13–S14] |
| Meta Business Agent Platform response | Separate Meta per-token pricing, effective August 1, 2026; **not the platform our Assistant uses**. |
| Our third-party model inference | Still our AI vendor's charge, separately from Meta delivery. No evidence that buying general-purpose-AI access is necessary for school-specific trial support. |

Recipient country/region drives message rates, not the rented school's +1 number alone. S2 says ordinary service rates equal the market's utility/authentication rates and have **no service volume tiers**. This note does not independently certify a numerical October US rate: the general rate-card heading still calls July 1, 2026 rates current and labels October updates “future.” Keep the previous partner-rate figures provisional until a written applicable-rate answer or real billed delivery. [S1–S2]

The separate **AI Provider** page still says ordinary-business service replies are free and addresses the general-purpose-AI exception in legally required markets (Brazil in its current market list), not a blanket US AI surcharge. This is distinct from both ordinary service pricing and Meta Business Agent token charges. Carry forward the school-specific interpretation from the policy research, but do not use that older pricing prose to override October's ordinary-service change. [S15]

`src/lib/whatsapp/templates.ts` renders `booking_confirmation` as a plain requested-booking confirmation naming school, participant, offering and time, with no promotion. That fits Meta's utility criteria: non-promotional and specific to the user's transaction/request. **Inference only:** the file explicitly says its strings are not submitted copy, and Meta may approve/reclassify actual templates differently. Monitor category as well as approval. [S13]

**Implementation caveat for any strict reply-only plan:** `planWhatsAppDelivery` in `src/lib/whatsapp/deliveries.ts` chooses an explicit template before checking the service-window expiry. `src/lib/whatsapp/booking.ts` queues the confirmation template. “Queued immediately after booking” does not prove every delayed/retried delivery remains in-window. A future reply-only change needs a send-time expiry check for templates too, and a defined email/failure fallback. No code was changed here. Even fixing that does not remove October's service/utility charges.

## 4. Can Fillthemat be a standalone Tech Provider with no Solution Partner?

**Yes technically, not with the proposed no-billing owner experience.** Meta explicitly allows independent Tech Providers. Keep direct Graph Cloud API sending and Meta HMAC webhooks, but replace shared-WABA/global credentials with school-owned assets/customer-scoped tokens, as the previous research established. Provider verification, reviews and Advanced Access remain necessary; reply-only does not waive them. [S4–S5, S7, S17]

For standalone production, the school adds billing in Manager and Meta bills it. For the settled **Fillthemat pays / owner never adds a payment method** constraint, partner-funded billing remains the documented alternative. A credit-only partner could preserve direct transport if commercially available and tested; this finding neither proves such an offer nor forces a transport migration. “No vendor” must also mean no **WhatsApp Solution Partner**, not literally no vendors: carrier number rental and model inference still cost Fillthemat money. [S7, prior partner research]

## 5. Who verifies the rented number, before or after authorization?

Three different operations must not be conflated: carrier number purchase, Meta's SMS/voice **OTP verification**, and Cloud API **registration** (which uses a separate two-step PIN).

- **Default popup:** owner enters/selects the provided number and enters its OTP. Since Fillthemat controls the carrier, our backend receives the SMS/voice code and must relay it to the owner. After the popup, Fillthemat exchanges the code for the school credential, subscribes the app and calls `/register`. Registration's six-digit PIN is not the SMS OTP. This does not achieve zero owner OTP entry. [S5, S11–S12]
- **Before popup:** Meta's documented **pre-verified-number pool requires an approved Solution Partner**. Plain Tech Provider status does not entitle Fillthemat to this pool. An eligible partner can preverify/share numbers, which the owner claims in signup without entering the OTP. Temporary preverified IDs are replaced by actual phone IDs; expiry/registration windows must be tracked. This supports the earlier 360dialog route conditionally, not a standalone exemption. [S18]
- **After popup:** Meta documents bypassing number addition/verification and then doing number creation, `/request_code`, carrier OTP reception, `/verify_code` and `/register` server-side. Thus the backend-verification mechanism exists once authorized school assets are available. **But the bypass example still uses `only_waba_sharing`/old session options; the earlier research found vendor v4 guides removing that legacy feature.** The generic registration guide does not establish today's v4 standalone bypass availability or eligibility. Treat no-owner-OTP post-popup onboarding as **unproved**, not impossible and not guaranteed. Pilot the current v4 Builder/configuration and actual customer token permissions. [S12, S18–S20]

Billing and OTP automation are independent gates. Solving one does not solve the other. No backend can verify a not-yet-created school asset under a customer credential it has not yet obtained; carrier purchase before signup is fine but is not school-WABA OTP verification.

## What would settle the remaining uncertainty?

**Narrow real pilot or written Meta support answer, not another broad vendor search:**

1. Obtain Meta clarification of the general “free” page versus S2's October 1 rules, specifically US school-specific third-party-AI service replies and in-window utility templates. Ask whether there is an explicit durable unfunded Tech Provider exception, its quota/expiry, and rollout status.
2. With an approved live Tech Provider app, create an actual external school's production assets through **v4**. Inspect funding (`primary_funding_id` on the actual Messaging Account), ownership, phone state and scopes; verify there is no card or inherited partner credit. A sandbox signup cannot send/receive messages. [S4, S6]
3. Send an ordinary inbound cold text from a US consumer number. Record delivered/failed statuses for text and interactive replies and an approved utility confirmation; capture the **pricing `billable`, `category`, `type`, `pricing_model`** fields and billing analytics. An HTTP 200/message ID alone is not delivery. Test funding attachment as a separate explicitly authorized follow-up if needed. [S2–S3]
4. Pilot the actual standalone v4 number-bypass option, if offered, and backend OTP verification under the returned customer token; otherwise record owner code-entry as required. Do not borrow an app-role test's permissions or a Solution Partner's pool eligibility.
5. Prove delayed/retried confirmation behavior at window expiry, template category changes, funding failure and account revocation before promising Live. One free message from an exceptional account would not disprove general dated pricing rules without Meta's written interpretation.

No such pilot, billing setup, number purchase or vendor contact was performed in this research session. **Do not close commercial/route tickets on the assumption of free replies.**

## Changes to the map's remaining questions

- **Get written quotes** ([#164](https://github.com/fillthemat/fillthemat/issues/164)): still necessary. Add explicit October 1 service/in-window utility rates, no service volume discounts, billable webhook examples and account funding requirements. The first-party change is a likely explanation for earlier rate-page conflicts, not invoice verification.
- **Choose the partner / OTP tradeoff** ([#165](https://github.com/fillthemat/fillthemat/issues/165)): still necessary under the standing no-owner-billing constraint. Direct standalone is an alternative only if the owner changes that constraint; no choice is made here.
- **Per-school templates** ([#143](https://github.com/fillthemat/fillthemat/issues/143)): narrow the runtime scope to the confirmation actually used; email reminders need no WhatsApp reminder template. If confirmation remains a template, per-school approval/category/readiness remains. Consider plain in-window text instead as a separate product/implementation decision: it can remove runtime template provisioning, **not billing**, and provider App Review still asks for template evidence. [S3, S10, S17]
- **Phase 6 pilot** ([#134](https://github.com/fillthemat/fillthemat/issues/134)): retain school-owned pilot and all runtime/security gates; add October pricing/funding/no-funding evidence and a real OTP/v4 test. Do not revert to shared-school identity or treat reply-only as a rollout shortcut.
- **Enable WhatsApp flow** ([#135](https://github.com/fillthemat/fillthemat/issues/135)): no-supported-billing means not Live even after a successful popup/number registration. Partner-funded happy path remains the current route; prototype cancellation/retry, truthful readiness and exceptional reconnection. No promise of “free forever” or guaranteed no future Meta action.

**Newly sharp open questions:** actual October pricing rollout/applicable US rates (quotes plus pilot); availability of standalone v4 post-popup number bypass/backend OTP (only worth pursuing if direct funding becomes acceptable); whether to replace the sole confirmation template with a service message; and strict reply-only handling of queued confirmations at expiry. These are findings for the parent session, not new tickets created here.

## Primary source register and document dates

All sources checked for the **2026-10-12 research record**. Most pages expose no publication/last-modified date; effective/release dates below are dates explicitly written in the documents, not invented page metadata. Meta Help Center bodies were inaccessible beyond title; its excerpt is labelled accordingly. Developer-community reports were not used as authoritative evidence.

- **S1 — General pricing:** https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing — per-message model **2025-07-01**, service-free history **2024-11-01**; fetched card heading **2026-07-01**, October updates still future-labelled. Full body retrieved.
- **S2 — Non-template pricing change:** https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages — Meta Business Agent launch **2026-07-01**, token billing **2026-08-01**, ordinary service and in-window utility billing **2026-10-01**. Full body retrieved; retains “upcoming” warning referring to S1. Payment-method deadline/stop-delivery sentence additionally available in first-party search excerpts but absent from fetched Markdown.
- **S3 — Current service-message guide/window/delivery:** https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages — undated; expressly says SERVICE billing. Full body retrieved.
- **S4 — Embedded Signup overview/billing/ownership/sandbox:** https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview — undated; v2 deprecation warning **2026-10-15**. Full body retrieved.
- **S5 — Tech Provider customer onboarding:** https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider — undated; mandatory payment step and earlier optional response test. Full body retrieved.
- **S6 — Messaging Account funding check:** https://developers.facebook.com/documentation/business-messaging/whatsapp/account-model-evolution/messaging/ — phased H2 2026 / H1 2027 / H1 2028 model; missing `primary_funding_id` means no paid sends. Full body retrieved; validate actual account-model rollout.
- **S7 — Partner tiers/independent operation/credit:** https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/overview — undated. Full body retrieved.
- **S8 — Messaging limits:** https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits — undated; portfolio/outside-window limits, 250 initial tier. Full body retrieved.
- **S9 — Throughput:** https://developers.facebook.com/documentation/business-messaging/whatsapp/throughput — undated; 80 mps default. Full body retrieved.
- **S10 — Template fundamentals/status/limits:** https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview — undated. Full body retrieved.
- **S11 — Default v4 popup screens/OTP:** https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/default-flow — undated; explicitly describes v4. Full body retrieved.
- **S12 — Number creation, OTP, registration:** https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/registering-phone-numbers — undated. Full body retrieved.
- **S13 — Template categories:** https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization — changes effective **2025-04-09** (utility can approve as marketing) / **2025-04-16** (misuse enforcement); current category rules retrieved in full.
- **S14 — US marketing delivery restriction:** https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/per-user-limits — undated retrieved page; explicitly says currently not delivered to US numbers. Full body retrieved.
- **S15 — Distinct general-purpose AI pricing:** https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/ai-providers — effective **2026-02-16**, updated market rules **2026-05-12/13**; still contains ordinary-service-free prose. Full body retrieved.
- **S16 — Meta Business Help Center billing and card instructions:** https://www.facebook.com/business/help/2225184664363779 and https://www.facebook.com/business/help/488291839463771 (also `?locale=en_GB`) — bodies inaccessible; first-party card-article excerpt says developer-console service messages are free, without an October effective date. Not evidence of an Embedded Signup production exception. Meta's marketing site https://business.whatsapp.com/products/platform-pricing also retains free-service prose in its fully fetched body.
- **S17 — Become a Tech Provider/reviews:** https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers — undated; independent operation, verification, Advanced Access, template/send video evidence and client billing. Full body retrieved.
- **S18 — Preverified numbers/eligibility:** https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/pre-verified-numbers — undated; Solution Partner requirement and 90-day constraints, v2 example. Full body retrieved.
- **S19 — Phone-addition bypass:** https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/bypass-phone-addition — undated; `only_waba_sharing` example, retiring-version warning. Full body retrieved. Compare the previous partner research's current vendor v4 evidence before using.
- **S20 — v4/customization:** https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-4 (release **2025-10-08**, v2 ends **2026-10-15**) and https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/custom-flows — undated customization page still lists phone bypass; neither establishes the exact standalone v4 configuration/eligibility. Full bodies retrieved.
