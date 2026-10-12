# Research: WhatsApp Business app coexistence

**Status:** research complete; conditional recommendation, not an ADR or implementation.
**Researched:** 2026-10-11.
**Question:** [#130](https://github.com/fillthemat/fillthemat/issues/130), feeding
[#129](https://github.com/fillthemat/fillthemat/issues/129).
**Code baseline:** `9004dcc`. No runtime, database, credential, or parent-map changes.

## Verdict for the decision map

**Coexistence is a technically suitable candidate for an eligible school's existing
WhatsApp Business app number, but not a verified universal US onboarding promise.**
Meta explicitly supports keeping the app and its number while Cloud API sends and
receives 1:1 messages, including echoes of app-sent messages. This can support a
booking Assistant alongside the School Owner's phone. However, the official sources
checked do not establish US eligibility or a fixed minimum account age/activity
threshold. A production-capable US pilot and Meta clarification remain launch gates.
Do not interpret missing restrictions in documentation as proof of eligibility. [S1, S5]

**Recommendation (inference):** offer coexistence when Meta accepts the actual
number and the School Owner accepts the feature losses, shared inbox policy,
payment setup, and device-dependent health requirements. Keep a
**Fillthemat-provided, dedicated Cloud API number** as the fallback for ineligibility,
owners unwilling to convert personal WhatsApp or alter their Business app features,
or schools needing an Assistant independent of the owner's phone. That fallback is
a different number, not a transparent takeover of their existing inbox; prospect
entry points must change. Its commercial ownership and provisioning still need a
decision. It avoids coexistence-specific restrictions, not ordinary Cloud API
templates, pricing, policy, or delivery constraints. [S1, S3, S8]

Do not promise an exhaustive mirror of the school's inbox: unsupported companion
clients and device re-registration can omit messages from Cloud API. Likewise,
an owner echo is a message notification, **not** a built-in pause/resume protocol or
a guarantee that an already-running Assistant turn will stop. [S1, S7]

## Evidence quality and document freshness

- **Confirmed** below means stated by Meta/WhatsApp, not exercised with a live school.
- **Unknown** means not established in the primary sources checked; it is not a
  negative eligibility finding. Vendor articles and developer-community questions
  were not accepted as evidence of platform policy.
- **Inference/recommendation** identifies Fillthemat consequences, not Meta requirements.
- All sources were consulted on 2026-10-11. See source dates at the end.
- Meta's rendered HTML and its Markdown/fetched representations differ. The rendered
  coexistence guide includes the new account model; its Markdown representation
  omitted it. The rendered default-flow guide includes Phone Number First and QR
  screens; its Markdown representation described the older generic flow. The
  rendered warnings deprecate **v2 and v3, including their public previews, on
  2026-10-15**; the Markdown warning mentioned only v2. Use v4. [S1, S2, S4]
- Rendered page badges also lag content: S1 displays 2026-06-26 despite the
  2026-09-22 account-model changelog update. Record both rather than treating the
  badge as the date of every claim. Direct HTTP retrieval of rendered pages and
  the changelog corroborated the newer content; it is not search-snippet-only evidence.
  [S1, S2, S9]

## 1. Eligibility and personal WhatsApp

| Question | Finding |
| --- | --- |
| Business app version | **Confirmed:** WhatsApp Business app **2.24.17 or newer**. Use the current app release for a pilot. [S1] |
| Fillthemat qualification | **Confirmed:** must already be a **Tech Provider or Solution Partner**, implement Cloud API, accept the required webhooks, and use Embedded Signup with session logging. Serving other businesses also requires applicable Advanced Access/App Review. Qualification and approval timing belong to #131. [S1, S4, S6] |
| United States | **Unknown in the checked primary sources.** S1 has no country matrix. The 2025-10-23 changelog expands support to Australia, Japan, Philippines, Russia, South Korea, Turkey, EEA/EU, and UK; that is an expansion list, not a complete eligibility list and does not establish US support. A US-coded example number or English (US) locale is not eligibility evidence. [S1, S9] |
| Number/account age and activity | **Unknown:** no published minimum age, number of chats, activity score, or guaranteed waiting period found in S1/S5. Do not encode a vendor-reported “7 days” or similar rule into settings. An existing Business app account is the documented starting point; individual eligibility must still be checked. [S1, S5] |
| Personal WhatsApp Messenger | **Confirmed:** coexistence onboarding is for the **Business app**, not Messenger. The owner can first move the same number to the Business app. Messenger and Business app cannot simultaneously use that same number. [S1, S10, S11] |
| Personal-to-Business history | **Confirmed:** WhatsApp recommends backing up first; update Messenger, install Business app, accept terms, select the existing number, allow chat-history/media access, verify the SMS code, and create the business profile. Migration supports chat history/media. WhatsApp warns app-internal contacts may be lost; save them to the phone address book first. This is separate from consenting to export history to Fillthemat. [S10, S11, S12] |
| Newly migrated personal account | **Unknown:** migration is not proof of immediate coexistence eligibility or a promise that all older history becomes API-accessible. Pilot this path separately. [S1, S10] |

Meta's documented support categories for unresolved eligibility are **WABiz:
Onboarding / TechProvider: Onboarding**, request type **Embedded Signup - Coexistence
Onboarding**. Ask for US availability and the actual number's eligibility, rather
than telling an owner to delete/re-register their account to try to unlock it. [S1]

## 2. What the School Owner and Fillthemat actually do

### Owner flow: current v4 Phone Number First rollout

The rendered default-flow guide documents this order; rollout is incomplete, so
some customers still see business assets before number entry. [S2]

1. Start Fillthemat's Embedded Signup window; authenticate with **Facebook or Meta
   Business Suite credentials**, then review authorization. This is a separate Meta
   login from the School Owner's Fillthemat login. [S2]
2. Enter/select the existing Business app number. With coexistence enabled, Meta
   detects the Business app number and enters coexistence automatically; the older
   flow instead offers an explicit Business app setup choice. [S1, S2]
3. Review the existing Business app profile (picture, name, number, category,
   website); confirm the correct account. [S2]
4. Select an existing **customer Meta business portfolio**, or create one by
   supplying business name, email, country, and website. Creation is subject to
   portfolio limits. A portfolio is not the Messaging account itself. [S1, S2, S6]
5. Scan the displayed **QR code from inside the WhatsApp Business app** on the
   owner's phone. Meta also sends a WhatsApp message linking to the QR code; scanning
   advances the flow automatically. [S2]
6. Confirm the read-only account name and required time zone, accept terms, and
   click **Finish** on the coexistence success screen. [S2]
7. Decide whether to share chat history when the app presents that consent. S1's
   alternate code-based description says open the official Facebook Business
   Account message, tap **Connect / Connect to the Business Platform**, confirm,
   choose history sharing, and paste the verification code. **Do not hard-code that
   older sequence as the only flow, or describe QR plus code as two universally
   required steps.** Capture the actual rollout experience in the US pilot. [S1, S2]
8. For the standalone Tech Provider route, add a payment method in **WhatsApp
   Manager → Overview → Add payment method**. Meta documents this as an additional
   customer step, not proof that popup completion alone means operational readiness.
   [S3]

**Duration:** Meta says onboarding and synchronization can take **several minutes**,
depending on history size, network speed, and webhook ingestion. There is no
documented fixed end-to-end duration including Meta login, portfolio creation,
payment setup, or Fillthemat's prerequisite approvals. A “five-minute setup” would
be an unverified product promise. Keep the Business app open during sync and show
progress/completion. [S1, S3]

### Backend completion is mandatory

- Capture session events and the exchangeable authorization code, including
  `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` and returned asset IDs; the old S1 example
  shows only `waba_id`, so do not assume every example supplies every needed ID.
  S3 allows retrieving the phone-number ID through the API. [S1, S3]
- Exchange the code **server-to-server** with the app ID/secret for the customer's
  Business Integration System User token; subscribe the app to that customer's
  account and required webhook fields. **Skip `/register` for coexistence** because
  the number is already registered, despite the generic S3 registration step. [S1, S3]
- Confirm `is_on_biz_app = true` and `platform_type = CLOUD_API`. Subscribe before
  sync requests, retain sync `request_id` values, and perform both contact/history
  sync steps promptly. Meta specifies a **24-hour synchronization deadline** after
  onboarding; missing it requires offboarding and repeating signup. Each initial
  sync can be requested only once per onboarding. [S1]
- Treat history refusal (`2593109`) as a consent result, not endless retry or a reason
  to force consent. A successful sync request means accepted, not sync completed
  or history-sharing permission granted. [S1]
- Readiness should include real inbound, app echo, outbound and delivery-status
  tests, billing state, and lifecycle subscription—not just a successful popup.
  This readiness definition is a recommendation. [S1, S3, S7]

## 3. What the integration receives

All message-bearing callbacks must route to the correct School/Channel using the
shared-account context and `metadata.phone_number_id`; never classify the owner's
outbound echo as a prospect request. This is an implementation consequence. [S1]

| Event/data | Documented shape and limits |
| --- | --- |
| New prospect message | `changes[].field = "messages"`, `value.messages[]`, with message ID, sender, timestamp/type and phone metadata. App/API messages mirror, subject to omissions below. [S1] |
| Owner/app-sent message | Subscribe to **`smb_message_echoes`**. The data array is **`value.message_echoes[]`**, not `messages[]`; items include `from` (business number), `to` (recipient), `id`, `timestamp`, `type`, and typed contents. Covers Business app and supported companion clients. Echo data does not identify which staff member authored it. [S1] |
| Contacts | Subscribe to **`smb_app_state_sync`**; request `/PHONE_NUMBER_ID/smb_app_data` with `sync_type: "smb_app_state_sync"`. `value.state_sync[]` includes `type: "contact"`, contact phone/name, `action: "add"` (new/edited) or `"remove"`, and timestamp. Initial WhatsApp contacts plus later changes; removal omits names. This is not a complete export of every phone contact. [S1] |
| Historical messages | Subscribe to **`history`**; request the same endpoint with `sync_type: "history"`. With consent, up to **180 days** of 1:1 messages, grouped in `value.history[].threads[].messages[]`; no group history. `from`/optional `to` determine direction; `history_context.status` is the latest historical status. [S1] |
| History progress/media | Three phases: 0–1, 1–90, 90–180 days; chunks can arrive out of order, so use `chunk_order`, `phase`, and `progress` (100 means sync complete). Media starts as placeholders; separate history callbacks supply media IDs only for the last **14 days**. A callback can contain **thousands of messages**: persist then process asynchronously. [S1] |
| API send status | `field: "messages"`, `value.statuses[]`, keyed by message `id`, with `sent`, `delivered`, `read`, `failed` (and `played` for voice). `read` can imply delivery without a separate delivered callback. These are not new inbound messages. [S3, S8] |
| App-send status guarantee | **Unknown:** S1 guarantees app echoes and historical status snapshots, but does not explicitly guarantee the full real-time API status stream for every app send. Test before showing definitive app-message delivery ticks or basing handover on a status. [S1, S8] |
| Account health/lifecycle | Subscribe to **`account_update`**, including removal, app uninstall, deletion/restriction, offboarding and reconnection; `disconnection_info` may include `reason` and `initiated_by`. New account-model guidance requires lifecycle coverage for both shared accounts. [S1, S7, S9, S13] |

**Confirmed omissions:** Windows and WearOS companion clients are unsupported in
the coexistence guide. A user can message the business from an unsupported client
without triggering a `messages` webhook; an outbound message viewed there can show
a primary-device placeholder. First-time messaging can yield error **`131060`**;
Meta says it typically resolves within seconds and instructs the owner to check
the Business app for the message. This is particularly relevant to first-contact
booking leads. No automatic recovery/replay guarantee is documented. [S1]

**Recommendation:** imported history/contacts are context, not permission to answer
or book; never enqueue historical messages as new Assistant work. Do not assume a
contact is a prospective student. In #132 choose who the Assistant should answer
in the existing main-number inbox; in #133 decide owner-echo takeover and resolve
in-flight response races. Neither policy is supplied by coexistence. [S1]

## 4. Limits and owner-facing feature losses

The following is **coexistence-specific**, not a claim that these features are
unavailable in every other Cloud API product. [S1]

| Feature | Business app after coexistence / API integration |
| --- | --- |
| Throughput | Fixed **20 messages/second**. Adequacy for a school's booking workload is an inference, not a measured capacity finding. |
| 1:1 chats | Retained and mirrored; edit/revoke now supported. Handle such events rather than promising edits/deletions disappear from all stored copies. [S5] |
| Groups | App group chats unchanged; **not synchronized or supported by this coexistence integration**. |
| Disappearing messages | Turned off for all 1:1 chats. |
| View-once and live location | Disabled for 1:1 chats. |
| Broadcast lists | Disabled; no new lists; existing lists read-only. |
| Voice/video calls | App functionality unchanged; not supported through this coexistence feature table. |
| Catalog, orders, Status, profile, Channels | App features unchanged; not exposed by coexistence's feature table. WhatsApp Status posts are not delivery-status webhooks. |
| Greeting/away messages, quick replies, labels and other messaging tools | App functionality unchanged; not synchronized as API tools. Existing app automations could conflict with Assistant replies (inference). |
| Linked devices | All companions unlinked on onboarding; owner must re-link supported clients. Up to four companion clients; Windows/WearOS excluded. |

**Window and pricing constraints:** app-sent messages remain free; Cloud API sends
follow Cloud API pricing. A new user message **after onboarding** opens the normal
24-hour customer-service window. Imported/pre-onboarding messages do not create a
window. Owner app sends neither create nor extend it, although the owner can still
reply from the app outside that window. The Assistant must not treat an echo or
history import as permission for a free-form API reply. [S1, S8]

**Privacy:** WhatsApp says 1:1 chats are now managed using a secure Meta service and
customers are notified of that change. Original edited/deleted messages may remain
visible on another business platform. Explain history sharing and retention rather
than describing coexistence as a privacy-neutral device link. [S5]

## 5. Ongoing operation, disconnect and reconnection

**Unresolved primary-source conflict:** WhatsApp Help Center says **open the
Business app at least once every 20 days** to keep synchronization. Meta developer
docs describe `PRIMARY_INACTIVITY` removal after **approximately 14 days**, and
`COMPANION_INACTIVITY` after approximately **30 days**. These statements do not
establish one safe exact deadline; ask Meta to reconcile them. [S1, S5, S13]

**Recommendation:** until clarified, tell pilot owners to open the app at least
weekly (our conservative practice, **not a Meta requirement**), show channel health,
and react to lifecycle events. Do not market this as a phone-independent service
or assume Assistant API traffic keeps the primary device active. [S1, S5]

- **Owner disconnect:** Business app **Settings → Account → Business Platform →
  Disconnect Account** (Help Center also describes tapping Connect to the Business
  Platform then Disconnect). Meta sends `PARTNER_REMOVED`; inspect optional
  disconnection details. The coexistence companion is disconnected, not an
  instruction to delete the owner's Business app account. [S1, S5]
- **Fillthemat side:** the ordinary **Deregister API cannot deregister a coexisting
  number**. Removing a webhook subscription or stopping Assistant replies is not
  the same as unlinking the Cloud API companion. S1 directs offboarding through the
  owner's app; no general partner-driven unlink API was established here. Provide
  immediate local disable plus accurate owner unlink instructions; verify any
  desired full server-side disconnect separately. [S1]
- **Integration revocation:** the customer can remove Fillthemat under Business
  Manager integrations/Connected apps, invalidating the Business Integration System
  User token. Distinguish loss of authorization from mobile companion unlinking.
  [S6, S13]
- **Device switch/reinstall/re-registration:** Cloud API companion automatically
  offboards; receive `ACCOUNT_OFFBOARDED` and pause pending API sends. New-device
  registration presents a prechecked opt-in to restore prior products; if the owner
  does not opt out, reconnection usually finishes in minutes and emits
  `ACCOUNT_RECONNECTED`. No other partner may onboard during that window. [S7]
- **During that gap:** API sending/receiving is suspended, partner access and
  subscriptions remain, chat history is not synced, and some messages may never
  arrive via Cloud API. Other companion clients are not automatically re-linked.
  Do not promise a lossless catch-up. [S7]
- **Other removal reasons:** downgrade to personal Messenger, change number,
  re-registration, account deletion/enforcement and inactivity. Some lifecycle
  payload additions roll out gradually; missing `disconnection_info` must not make
  the channel look healthy. [S1, S9, S13]

## 6. Account ownership, billing and credentials

### Ownership: distinguish the legacy label from the new account model

**Confirmed in current rendered documentation:** Meta converts the customer's
existing WABA into a backward-compatible **Messaging account**, retaining its ID in
`waba_id`. It shares the associated **WhatsApp account (WAAC)** and converted
Messaging account with the partner. **No partner-specific Messaging account is
created for coexistence**; both remain associated with the customer's Meta business
portfolio. `business_id` means portfolio ID, not `waba_id`; the WAAC ID is not returned
in this phase. [S1]

The **2026-09-22 changelog** says Phase 1 starts **2026-09-23**, reaches all businesses
by **mid-October 2026**, and preserves existing IDs, endpoints and tokens. Some
customers still see the old WABA UI during rollout. The general account-model
onboarding guide describes separate partner Messaging accounts; **do not apply
that general rule to coexistence against its explicit exception**. [S9, S14]

This **conflicts with shared-Fillthemat-WABA decision D9** in
`docs/whatsapp-plan.md` for the coexistence path; it does not by itself decide whether
the shared model should remain for the pilot/provided-number path. #134 remains a
valid tenancy decision, but its premise/name “per-school WABAs” needs refinement:
decide customer-owned WAAC/Messaging-account authorization, legacy-ID compatibility,
and coexistence versus provided-number tenancy, not “create a new WABA for every
coexistence school.” No ADR or existing plan is superseded by this research alone.

### Whose payment method?

**Standalone Tech Provider:** Meta explicitly tells the **customer** to add a
payment method in WhatsApp Manager. Therefore “owner needs only login + QR” is not
the complete documented route. Whether/how Fillthemat absorbs costs instead is
not answered by coexistence and requires the commercial/onboarding choice in #131.
**Solution Partner:** the onboarding guide includes sharing the partner's credit
line, so payment arrangements differ by provider model. Existing previous-partner
credit-line sharing can block onboarding to a new partner. [S1, S3, S15]

### What token does Fillthemat hold, for how long?

- **Business Integration System User (BISU/business) access token per customer**,
  obtained by server-side exchange of the signup code. It represents delegated
  access to that customer's designated assets, not the School Owner's personal
  Facebook user token and not one omnibus Fillthemat token. [S3, S6, S16]
- Facebook Login for Business documents **default never-expiring** tokens for
  offline server-to-server use; expiration is configurable, and token management
  supports an optional **60-day** expiry. “Never expires” is not “cannot be revoked”:
  customer removal of Connected apps invalidates it. Confirm actual token expiry
  and authorization in the chosen configuration. [S6]
- Solution Partners use their system-user token for credit sharing and BISU tokens
  for other customer actions; direct developers use system-user tokens for their
  own business, not as a substitute for onboarding separate schools. [S16]
- **Recommendation:** store credentials securely per customer, keep app secrets
  server-side, choose least-privilege permissions, validate asset-to-School mapping,
  and make revocation/reconnect visible. These are not changes made in this branch.

## 7. Fit, existing tickets and newly surfaced work

### Keep the existing questions, with these inputs

- **#131:** qualify as Tech Provider/Solution Partner, configure v4 and Advanced
  Access, choose customer payment versus partner billing, and establish revocable
  per-customer credentials. No approval-time estimate is established by #130.
- **#132:** an existing main number receives students, suppliers, friends and
  non-booking contacts too. Which senders/entry points receive Assistant replies?
  Coexistence is not a prospect classifier.
- **#133:** use `smb_message_echoes` as a takeover signal, then decide scope,
  pause/resume semantics, app automation handling and in-flight cancellation.
- **#134 (partly mis-scoped):** retain the tenancy decision but update its WABA
  premise for the explicit coexistence account-model exception; distinguish
  customer ownership from partner access and the provided-number fallback.
- **#135:** prototype eligibility rejection/unknowns, rollout-sensitive screens,
  migration caution, feature-loss consent, optional history import, billing,
  synchronization progress, disconnected/offboarded/revoked health, reconnect,
  and local disable versus genuine unlink. Do not collapse all of these into
  a single “connected” boolean.

### Newly surfaced questions/ticket candidates (not created)

1. **US production eligibility proof:** exercise an existing US Business app number
   and a newly migrated personal number with a qualified integration; ask Meta for
   country and age/activity policy. Measure actual QR/login/billing duration.
2. **Lifecycle and coverage spike:** test first-contact `131060`, unsupported
   companions, app echoes (including staff/app automation and status coverage),
   edit/revoke, device re-registration, user unlink and token revocation; reconcile
   14-versus-20-day guidance and define owner/operator alerts.
3. **Sync ingestion and privacy implementation:** decide whether to import history
   at all; separate import from new Assistant turns, tolerate out-of-order chunks,
   enforce retention/consent, and support large signed webhook bodies safely.
4. **Provided-number product policy:** whose number/account/payment, where leads
   enter, how human takeover works without the original mobile inbox, and whether
   the manual Phase 6 pilot remains separate from self-serve coexistence.

**Code-grounded blockers, not speculative refactors:** at `9004dcc`,
`src/lib/whatsapp/parse.ts` reads only `value.messages[]`, not echoes/history/state
sync, and does not discriminate by webhook field. `src/lib/whatsapp/config.ts`
uses one environment `WHATSAPP_SYSTEM_USER_TOKEN` and a **64,000-byte webhook cap**.
That cap is incompatible with assuming S1's potentially thousands-of-messages
history callbacks will fit. Existing code is not a ready coexistence implementation;
subscribe/import only after handlers, credential routing, and safe ingress are
designed. No undocumented “just increase the limit” change is proposed here.

## Primary sources

All accessed **2026-10-11**. Badges are page-level dates, not necessarily dates of
all content. WhatsApp Help Center articles below showed no substantive update date;
their ©2026 footer is not one. Help Center content was recovered from indexed
first-party article text where direct fetch returned no body.

- **S1 — [Onboard WhatsApp Business app users](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users?locale=en_US).** Rendered badge **2026-06-26**; account-model content corroborated by S9's **2026-09-22** entry. Requirements, sync, echoes, limitations, offboarding. HTML checked directly because the [Markdown representation](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users.md) omitted newer content.
- **S2 — [Embedded Signup default flow](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/default-flow?locale=en_US).** Rendered badge **2026-09-03**; current HTML contains Phone Number First rollout and coexistence QR screens absent from its fetched Markdown representation.
- **S3 — [Onboarding customers as a Tech Provider/Tech Partner](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider.md).** No update date in retrieved body. Code exchange, customer subscription, tests, customer payment step; S1 overrides its generic `/register` step for coexistence.
- **S4 — [Embedded Signup v4](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-4.md).** Explicit release **2025-10-08**; supported Business app onboarding, configuration and Advanced Access. Current rendered S1/S2 deprecation warning covers v2 **and v3** on **2026-10-15**.
- **S5 — [How to connect your WhatsApp Business app to Business Platform](https://faq.whatsapp.com/8122483904494954).** No update date found. Six-month history, 20-day app opening, privacy, disconnect. Indexed first-party article text; direct fetch returned no body.
- **S6 — [Facebook Login for Business](https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business).** No update date in retrieved body. Separate client/provider portfolios, delegated BISU tokens, default never-expiring lifetime, optional 60-day expiry, revocation.
- **S7 — [Reconnect offboarded coexistence clients](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/reconnect-offboarded-coexistence-clients).** No update date in retrieved body. Device switches, opt-in reconnection, lifecycle events, suspended messaging and missed-message limits.
- **S8 — [Status messages webhook reference](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status.md).** No update date in retrieved body. Delivery states and pricing/window distinctions; not evidence that every app echo receives every API status.
- **S9 — [WhatsApp changelog](https://developers.facebook.com/documentation/business-messaging/whatsapp/changelog?locale=en_US).** Entries **2026-09-22** (coexistence account-model update and rollout) and **2025-10-23** (country expansion). Direct HTML/CMS payload checked because an earlier fetched representation ended at older entries.
- **S10 — [Move Messenger to the Business app](https://faq.whatsapp.com/3059780464322392).** No update date found. Backup, permissions, same-number SMS verification, profile and contact-loss warning. Indexed first-party article text.
- **S11 — [Moving between Messenger and Business app](https://faq.whatsapp.com/663543925287107).** No update date found. Same-number exclusivity and migration. Indexed first-party article text.
- **S12 — [Download the Business app](https://faq.whatsapp.com/665643701880397).** No update date found. Chat-history/media migration support. Indexed first-party article text.
- **S13 — [account_update webhook reference](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/account_update.md).** No update date in retrieved body. Approximate 14/30-day inactivity reasons, optional disconnection details, revocation/offboard/reconnect events.
- **S14 — [Account-model onboarding changes](https://developers.secure.facebook.com/documentation/business-messaging/whatsapp/account-model-evolution/onboarding).** Retrieved representation gives Phase 1 H2 2026, Phase 2 H1 2027, mandatory transition H1 2028. General partner-specific account rule; S1's coexistence exception and S9's dated rollout are more specific.
- **S15 — [Onboarding customers as a Solution Partner](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-solution-partner).** Credit-line sharing route; do not conflate with S3's standalone Tech Provider billing.
- **S16 — [Access Tokens Guide](https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens.md).** No update date in retrieved body. Token type by developer/provider role and per-customer BISU scope.
