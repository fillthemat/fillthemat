# Research: booking confirmations on school-owned WhatsApp accounts

**Research date:** 2026-10-12 (requested decision date). **Ticket:** [How does the booking confirmation get sent on each school's account: an approved template, or a plain reply?](https://github.com/fillthemat/fillthemat/issues/143), child of [the onboarding map](https://github.com/fillthemat/fillthemat/issues/129).
**Evidence:** Meta primary documentation and repository code at `2bf976d` (`origin/main` when the worktree was created). Documentation research only: no production send, approval submission, number purchase, configuration change, or implementation.

## Recommendation

**Plain reply only on WhatsApp, with bounded in-window retries and an owner-email failure alert.** Do not provision a per-school runtime confirmation template for this version. This is the simplest option consistent with the standing rule that the Assistant never starts conversations. A template fallback after expiry would reopen a closed customer-service window from the business side; Meta permits it for appropriate opted-in utility notifications, but adopting it would require an explicit product exception to strict reply-only behavior. [S1, S4, S12]

This is a recommendation, not a claim that plain text guarantees delivery. Preserve the booking when notification fails; expose the failure and ask the School Owner to follow up outside Fillthemat. **The existing WhatsApp booking path stores no prospect email**, so an automatic email to the prospect is not an existing fallback. The owner alert is an operational safety net, not proof the prospect received confirmation. If guaranteed automatic notification attempts beyond 24 hours are a requirement, choose **plain reply with approved utility-template fallback**, explicitly allow that exception, and accept per-school approval/readiness/monitoring. No WhatsApp option guarantees actual delivery. [C1–C4, S1–S4]

Plain reply removes template provisioning and review delay, **not the school's card step, provider App Review, or Meta fees**. Build on the resolved [school-card decision](https://github.com/fillthemat/fillthemat/issues/165) and [reply-only billing investigation](https://github.com/fillthemat/fillthemat/issues/166). The latter's branch note was read rather than its billing/OTP research repeated. Meta's specific pricing update announces service and in-window utility charges effective October 1, 2026; the general pricing prose remains contradictory, so actual rates/rollout still need pilot evidence. [S1, S7, S10; prior research]

## 1. Can the confirmation be a plain reply? What happens to a late retry?

### Documented facts

- A customer-service window starts with a user message (the current guide also covers calls) and lasts 24 hours; further user messages/calls reset it. **Our send, booking write, webhook replay or retry does not reset it.** Free-form service messages require no template pre-approval. When the window closes, only pre-approved template messages may be sent. [S1]
- Text is supported through `POST /<PHONE_NUMBER_ID>/messages` with `type: text`, `text.body`, and the customer's business token. The limit is 4,096 characters. Interactive reply-button messages are also supported in-window: up to three buttons, 1,024-character body and 20-character labels. Plain text needs no interactive UI just to announce a completed booking. [S1, S8–S9]
- A successful response/message ID proves request acceptance, not delivery. Use `messages` status webhooks for delivered/read/failed evidence. Meta's own delivery retries after acceptance (default non-authentication TTL: 30 days) are distinct from **our new API send attempts**. Do not claim that every accepted in-window message must reach the device within that same window. [S1]
- Meta documents rare cases where an inbound message still cannot be answered in-window. Retain failure handling even with correct local timestamps. [S1]

### Proposed behavior (inference/design, not current code)

1. After the platform commits the booking, durably enqueue its deterministic confirmation text with `bookingId`, a stable confirmation idempotency key, and a real window deadline.
2. Derive the deadline from the most recent genuine inbound Meta message timestamp for **this school number + contact**, not `now()` at job execution. Retain the maximum timestamp monotonically despite out-of-order/replayed webhooks. Missing/invalid timestamps must not invent an open window. A newer genuine message can open a window, but do not automatically revive an already terminal old confirmation; answer booking-status enquiries as new turns.
3. Check eligibility immediately before **every** transport attempt, including delayed first sends, asynchronous failure retries and crash recovery. Apply a small safety margin at the boundary; treat Meta window-closed error `131047` as terminal, not an excuse to start a fresh 24-hour timer.
4. If the window is closed, stop the WhatsApp delivery, retain the booking, record `window_closed`, and atomically enqueue one owner-email failure alert (unless the class has already started). No template fallback and no repeated outbound attempts after expiry.
5. Preserve bounded retry/recovery, delivery receipts and stale-at-class-start suppression independently of the message's transport type. If the prospect sends a new enquiry, the Assistant can report the existing booking without booking again.

**Why send-time matters:** immediate enqueue does not guarantee immediate execution; outages, delayed webhooks, stalled workers and crash recovery can cross the boundary. Meta's TTL is not permission for our application to issue a fresh free-form API request after expiry. [S1; C1–C5]

## 2. Exactly what today's code does

All C references below point at the audited commit, not the future research branch's proposed implementation.

| Stage | Code facts |
| --- | --- |
| Booking trigger | `confirmWhatsAppBooking` runs after an explicit affirmative or `confirm_booking:<id>` button for a Booking Intent. It calls `bookSlot` with a deterministic `(schoolId, inbound wamid)` UUID, a phone, and **`email: null`**. The owner email is separate; no prospect confirmation email is scheduled for this contact. [C1] |
| Immediate confirmation | After booking success it marks the intent confirmed, appends a deterministic-looking assistant transcript, then queues **`templateName: booking_confirmation`** with school, participant, offering and school-timezone date. Key: `booking-confirmation-template/<bookingId>`. It supplies **no `windowExpiresAt` or plain body** on that delivery. The transcript is not proof of receipt. [C1] |
| Queue/dedupe | `enqueueWhatsAppDelivery` inserts an immediately due `pending` row, ignores a duplicate provider-idempotency key, and `enqueueAndAttemptWhatsAppDelivery` immediately claims/attempts only a newly inserted row. The key deduplicates local queue creation; `client.ts` does not transmit it to Meta as an exactly-once provider key. An ambiguous network/crash outcome can still lead to duplicate external sends. [C2, C6] |
| Window handling | `planWhatsAppDelivery` returns an explicit template **before any window test**. Plain/interactive sends require persisted `windowExpiresAt > now` at send planning. Therefore today's confirmation may be sent/retried outside the window. It is template-only, not a text-to-template fallback. [C2] |
| Wrong clock for a future text conversion | Booking notices calculate expiry as worker `now + 24h`; ordinary worker reply paths do likewise. The inbound parser drops `messages[].timestamp` entirely, and jobs persist that normalized payload. Simply replacing the template with text and `now + 24h` would still be incorrect for delayed inbound/job execution. [C1, C5, C7–C8] |
| Retry policy | Five started executions maximum; transient/unknown failures back off 10, 20, 40, 80 seconds between attempts (the formula yields 160 seconds at execution five, but exhaustion stops there). Permanent errors including `131047` stop immediately. Claims abandoned over five minutes are recovered, retaining the execution budget. The worker retries within a four-minute invocation budget; persisted work also awaits later sweeps. Thus nominal short backoff is not a bound on elapsed wall-clock age. [C2–C3, C5] |
| Async statuses | Accepted sends become `sent` with provider ID. A failed webhook for the current attempt invokes the same retry policy. Later positive delivered/read evidence for that attempt cancels its retry; receipt timestamps and claim fencing protect against regressions. Sent is not delivered. [C2, C6] |
| Stale/failure fallback | Before sending/retrying, a confirmation becomes stale if its trial has started. Terminal non-stale confirmation failure atomically queues one `owner_whatsapp_confirmation_failed` email. **Both stale detection and owner-alert eligibility currently require `templateName === booking_confirmation`**. A naïve text conversion would lose both protections. Key behavior must attach to confirmation purpose/booking identity instead. [C2, C4] |
| Template submission | `templates.ts` is a local registry with confirmation/reminder/lead names and parameter labels, explicitly **not submitted copy** and no submission API. Only booking confirmation is currently queued as a template; registry entries do not mean reminder/lead templates are actually sent. Implemented reminders are email; **no-email WhatsApp bookings are skipped and currently get no automated reminder**. The maintenance comment mentioning a future Phase 6 WhatsApp reminder is not an implemented sender. [C1, C9–C10; repo search] |
| Credentials | Transport defaults to one `WHATSAPP_SYSTEM_USER_TOKEN`; text and interactive transport already exist, but customer-scoped credential selection remains necessary for school-owned accounts. [C6, S5–S7] |

## 3. If we retain a template, can submission be automatic after the popup?

**Yes, conditional on authorized customer assets and the correct permissions; no human must type each template into WhatsApp Manager.** Templates are WABA assets, not assets shared globally across unrelated school WABAs. Each school's account needs its own approved template, even if we use identical name/language/content. [S2, S4–S7]

Documented sequence:

1. The owner finishes Embedded Signup. Exchange its returned code server-side for that customer's **Business Integration System User access token** and obtain their WABA and phone-number IDs. Meta says Tech Providers should use these individual customer-scoped business tokens. [S5–S6]
2. With the owner's granted asset access and `whatsapp_business_management`, submit `POST /<SCHOOL_WABA_ID>/message_templates`, specifying name, `UTILITY`, `en_US`, body/components and sample values for every variable. App Review/Advanced Access is required to manage WABAs not owned by Fillthemat; a generic Fillthemat token or an app token is not a substitute for school authorization. Sending separately requires `whatsapp_business_messaging`. [S2, S4–S7]
3. Creation automatically initiates review. Persist the returned template ID/category/status; read status via the API and consume `message_template_status_update` and category updates. Reconcile an existing name/language instead of blindly creating duplicates on popup retries. No code implements this lifecycle today. [S2–S4; C9]

**Review time:** Meta says an approval decision can take **up to 24 hours**, not that every school will be approved instantly or that successful submission means approval. Rejections require edits/resubmission or appeal; the review guide says an appeal decision is made within 24 hours. Treat those as published timing guidance, not a guaranteed onboarding SLA. Only `APPROVED` can be sent; pause/disable later makes an approved template unusable. [S2–S3]

**What gets rejected or reclassified:** [S2–S4]

- Missing/malformed/misordered positional variables; too many variables relative to text; starting or ending with a variable; missing samples for variables.
- Invalid character/text/component formats or limits; duplicate body/footer copy within the relevant account's existing templates.
- Spam/scam-like, abusive/threatening, prohibited commerce/business-policy content, or requests for sensitive full identifiers.
- Wrong category, ambiguous generic text, persuasive/promotional content or mixed utility/marketing. Utility must be **non-promotional** and tied to the user's specific request/transaction (or essential/critical use case).

**Inference:** a factual confirmation naming the requested trial, participant, class and time fits utility. That is not actual approval. Avoid membership offers, discounts, promotional slogans and generic all-variable copy. Since April 9, 2025 Meta can approve a requested utility template **as marketing**; approval alone is insufficient. Its current docs say marketing templates are not delivered to US recipient numbers. Check actual `category` as well as `status` and track later changes. [S4, S11]

## 4. What must Live wait for?

**Recommended plain-reply version:** no per-school template review gate. Live still requires the school to be approved/published, its number verified/registered and profile configured, the owner to grant valid customer-scoped access, correct school routing and webhook subscription, and a usable school payment method. Provider verification/App Review are platform-wide prerequisites, not removed by using text. Readiness must be reconciled after returning from WhatsApp Manager; visiting the card page or completing the popup is not proof of funding. A production pilot must demonstrate actual inbound and delivered reply/confirmation statuses, not just a sandbox popup or HTTP 200. Do not add a mandatory WhatsApp message/test for every owner without a separate UX decision; per-school Live can use validated readiness while the rollout pilot proves the end-to-end integration. [S1, S5–S7; decisions in issues 165–166]

**Template-only version:** add an account-specific sendable `APPROVED` **utility** template in the required language to the Live gate; otherwise the first booking's only confirmation path is broken. Submission/pending/marketing approval cannot satisfy that gate. Later pause/category/funding/access changes need visible failure handling. [S2–S4, S11]

**Plain + template-fallback version:** ordinary replies technically work before template approval, but if Live promises reliable automated *late* confirmation attempts, wait for the fallback's approved utility status too. Calling this fully Live before approval would mean offering a deliberately degraded mode; that is a product choice, not a Meta requirement. [S1–S4; inference]

## 5. Comparison and ticket impact

| Option | Main benefit | Tradeoff |
| --- | --- | --- |
| Plain only (recommended) | No customer template lifecycle, fastest path to reply-only Live | Cannot automatically send a new confirmation after expiry; owner alert/follow-up required, especially since no prospect email exists |
| Template only | Lowest change to today's send payload and permits delayed sends | Per-school approval/category/quality lifecycle and Live delay; outside-window sends need a reply-only exception |
| Plain + template fallback | Normal path is a reply; approved utility permits late automated notification | Both send paths plus per-school template lifecycle; explicit product exception, consent, limits, TTL/staleness and monitoring |
| Plain + required prospect email | Automated non-WhatsApp recovery without template | New contact-collection/storage/consent/booking UX work; not the current simplest path |

- **[Enable WhatsApp settings flow](https://github.com/fillthemat/fillthemat/issues/135):** under the recommendation remove “preparing confirmation template/awaiting approval” from onboarding; keep owner card, registration/access/subscription readiness. Explain confirmation failures truthfully in owner notifications/audit, and do not label a failed send as delivered. [C1–C9, S1, S5]
- **[Shared-WABA code and Phase 6 pilot](https://github.com/fillthemat/fillthemat/issues/134):** remove shared runtime template submission as a per-school gate if this recommendation is adopted, not provider-level review evidence. Replace global credentials and prove school isolation. Pilot delayed inbound processing, just-before/after window expiry, async failures, exhausted retries, crash recovery, class-start staleness, owner-alert exactly-once queueing, and genuine delivered receipts. This finding does not authorize piloting unrelated schools on a shared WABA. [C1–C9, S1–S7]

**Open product question for the parent session:** does “never starts conversations” prohibit all outside-window platform notifications, or only unsolicited sales/Assistant outreach? Recommend the strict interpretation and owner fallback. If the owner instead requires automatic WhatsApp attempts after 24 hours, record the narrow transactional exception and choose plain + utility-template fallback. No new issue was created; do not quietly infer permission. Funding/readiness detection and card failures remain the map's existing open questions, not solved here. Actual October US fees remain the previous research's pilot/Meta clarification item.

The old issue comment calling this coexistence-only is obsolete: the actual confirmation code and school-owned new WABAs make this relevant even without coexistence. Parent-map body was not edited.

## Sources and document dates

All sources retrieved for the **2026-10-12** research record. No publication/last-modified date was exposed by most developer guides; dates below are explicit effective/deprecation dates, not invented page metadata. Full bodies were retrieved. No secondary vendor article is used as authority.

- **S1 — Service messages, window, acceptance/delivery, TTL:** https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages — undated; current body expressly says SERVICE billing.
- **S2 — Template fundamentals, creation, statuses, limits:** https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview — undated; up-to-24-hour review guidance.
- **S3 — Review timing, samples, rejection and appeal:** https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-review — undated.
- **S4 — Utility criteria and category updates:** https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization — explicit changes **2025-04-09** (utility may approve as marketing), **2025-04-16** (misuse enforcement); other current prose undated.
- **S5 — Post-popup Tech Provider onboarding and funding:** https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider — undated; v2 deprecation **2026-10-15**.
- **S6 — Customer business tokens and asset access:** https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens — undated.
- **S7 — Permissions/Advanced Access:** https://developers.facebook.com/documentation/business-messaging/whatsapp/permissions — undated.
- **S8 — Text sending:** https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/text-messages — undated.
- **S9 — Interactive reply-button sending and inbound timestamps:** https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-reply-buttons-messages — undated.
- **S10 — Dated pricing update:** https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages — service/in-window utility changes **2026-10-01**; still “upcoming”-labelled, a conflict already recorded in the previous billing research.
- **S11 — US marketing restriction:** https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/per-user-limits — undated; current body says US marketing delivery unavailable.
- **S12 — Template creation/read/edit endpoint:** https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-account/message-template-api — undated.

Code sources (fixed audited commit):

- **C1:** https://github.com/fillthemat/fillthemat/blob/2bf976d/src/lib/whatsapp/booking.ts — trigger, null email, transcript, template enqueue.
- **C2:** https://github.com/fillthemat/fillthemat/blob/2bf976d/src/lib/whatsapp/deliveries.ts — plan/enqueue/send/receipts/recovery.
- **C3:** https://github.com/fillthemat/fillthemat/blob/2bf976d/src/lib/retry-policy.ts — execution cap, delays, permanent/stale errors.
- **C4:** https://github.com/fillthemat/fillthemat/blob/2bf976d/src/lib/whatsapp/confirmation-delivery.ts — template-gated staleness and atomic owner email.
- **C5:** https://github.com/fillthemat/fillthemat/blob/2bf976d/src/lib/whatsapp/worker.ts — processing-clock expiry and bounded worker retries.
- **C6:** https://github.com/fillthemat/fillthemat/blob/2bf976d/src/lib/whatsapp/client.ts — text/interactive/template transport, global credential default, acceptance semantics.
- **C7:** https://github.com/fillthemat/fillthemat/blob/2bf976d/src/lib/whatsapp/parse.ts — normalized inbound payload omits Meta timestamp.
- **C8:** https://github.com/fillthemat/fillthemat/blob/2bf976d/src/lib/whatsapp/jobs.ts — inbound job persistence/deduplication.
- **C9:** https://github.com/fillthemat/fillthemat/blob/2bf976d/src/lib/whatsapp/templates.ts — registry only, not submitted content.
- **C10:** https://github.com/fillthemat/fillthemat/blob/2bf976d/src/lib/email/maintenance.ts — email reminder queue, skips bookings without contact email.
- **Prior research:** https://github.com/fillthemat/fillthemat/blob/research/whatsapp-reply-only-billing/docs/decisions/whatsapp-reply-only-billing-research.md and resolution comments on [school-card decision](https://github.com/fillthemat/fillthemat/issues/165) / [reply-only billing](https://github.com/fillthemat/fillthemat/issues/166).
