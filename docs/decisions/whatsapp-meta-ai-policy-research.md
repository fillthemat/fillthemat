# Research: Meta AI policy and multi-school WhatsApp ownership

**Date checked:** 2026-10-12. **Status:** research resolution, not an implementation or Meta approval.
**Ticket:** [#152](https://github.com/fillthemat/fillthemat/issues/152), child of [#129](https://github.com/fillthemat/fillthemat/issues/129).
**Background:** resolution comments on [#144](https://github.com/fillthemat/fillthemat/issues/144) and [#145](https://github.com/fillthemat/fillthemat/issues/145).
**Scope:** independent US martial-arts schools, approximately 50 in 12 months; a school-specific Assistant answering trial questions and preparing bookings. No code, account, billing, or environment changes.

## Verdict

- **Business-specific booking Assistant: allowed in principle, with conditions.** The AI restriction targets making AI technology the primary functionality, not every use of an LLM. The current terms expressly allow a business to retain an AI Provider as its Solution Provider. A bounded school customer-service/booking Assistant fits that permitted use; this classification is an inference from the terms, not a written approval for Fillthemat. Meta retains sole discretion. [S1, S2]
- **One Fillthemat-owned WABA containing numbers for unrelated schools: no, do not ship this structure.** Twilio's official ISV guide explicitly says, “WhatsApp doesn't allow senders from different businesses to be registered in the same WABA.” Meta's own onboarding documentation assigns the client its assets and has retired the provider-owned On-Behalf-Of model. A different number and school display name do not cure account ownership. [S4–S7]
- **Closest documented compliant structure:** one shared Fillthemat app as a Tech Provider, client-owned WhatsApp assets per school via Embedded Signup, with a Fillthemat-supplied new virtual number. Pair with a Solution Partner for centralized billing so Fillthemat can absorb charges. This does not require coexistence or an owner's existing number. [S4, S7–S9]
- **No documented structure preserves literally zero school-side Meta authorization.** Embedded Signup still requires authentication, terms acceptance and asset permissions. Partner-initiated creation still requires the client to accept a request in Meta Business Suite and gives ownership to the client. Creating 50 school-named accounts inside Fillthemat's portfolio is not the replacement. [S4–S6]

## 1. What the 2026 AI policy actually says

### Confirmed facts

The old WhatsApp Business Solution Terms URL now resolves to **Meta Terms for WhatsApp Business Platform**, last modified **September 23, 2026**. Use the current terms, not just articles quoting the October 2025 announcement. Section 4.7 defines AI Providers broadly, including providers/developers of LLMs, generative AI platforms and general-purpose assistants. It prohibits direct or indirect use to distribute such technologies **when they are the primary rather than incidental or ancillary functionality**, as determined by Meta in its sole discretion. It then expressly says:

> “Notwithstanding the foregoing, you may retain an AI Provider as your Solution Provider.” [S1]

Meta's AI-provider pricing documentation dates the general-purpose restriction to **January 15, 2026**, and says those assistants are permitted only where Meta is legally required to permit them. Its listed exception markets do not include the US. It explicitly says the special pricing does not change ordinary business pricing, including free non-template messages in an open customer-service window. Paying the AI-provider rate is not a US permission workaround. [S2]

Section 4.7 also restricts using WhatsApp Business Platform Data, including anonymous/aggregate/derived forms, to create, develop, train or improve AI models. There is a narrow exception for fine-tuning a model for exclusive use without improving other models. This is not blanket permission to pool all schools' chats into model training. The restriction survives termination. [S1]

### Application to Fillthemat — inference, not an approval

The prospect is receiving a school's trial information and booking service, not general-purpose access to an AI model. Fillthemat can be an AI-enabled Solution Provider for the school; it need not claim that it cannot possibly be an “AI Provider.” The explicit Solution Provider exception is the stronger basis. Serving many clients does not itself change the function into general-purpose AI, provided each school's account, authorization and experience are correctly structured. [S1, S4, S8]

Keep the Assistant bounded to the school's services, live trial availability, Booking Intents and Lead Requests; refuse unrelated open-domain requests. Do not advertise “ask anything” or provide model access as the WhatsApp product. Ensure inference providers do not use these chats for shared-model training; do not assume anonymization makes training permissible. These are compliance recommendations derived from section 4.7, not a claim that the terms mandate a particular prompt or refusal implementation. [S1]

## 2. Disclosure, opt-out and human escalation

### Confirmed requirements

The **WhatsApp Business Messaging Policy**, last updated **September 23, 2026**, requires: [S3]

- Accurate business identity and affiliation, permission to represent the school, and an up-to-date profile with customer-support contact information and at least an email, website and/or phone number.
- Necessary notices, permissions and consents for collecting, using and sharing content, including a published privacy policy. Cloud API terms separately require a lawful basis and necessary rights/consents for client content. [S10]
- Recipient permission for subsequent outbound contact; honor requests, on or off WhatsApp, to block, discontinue or opt out of communications. Do not treat an inbound trial question as permission for unrelated future marketing.
- Approved templates for initiating conversations and for messages outside the 24-hour customer-service window; in-window automation is expressly permitted.
- **Prompt, clear and direct escalation paths.** The permitted list includes in-chat human transfer, a phone number, email, web support, in-store visits or a support form. Live in-chat human takeover is not mandatory.

### What is and is not established

No universal requirement for a specific “AI-generated” label, a separate AI opt-out switch or mandatory live-human WhatsApp takeover was found in the reviewed general platform terms and messaging policy. This is a scoped negative finding, not an assertion about every law or optional Meta AI product. Do not mislead users into believing the Assistant is a person. Recommended opening/profile language identifies it as the school's automated booking Assistant, explains Fillthemat's role and links privacy/support information. [S1, S3]

The existing Lead Request → lead → owner follows up outside Fillthemat can remain **if** the prospect has a clear, immediately usable way to reach a person, such as the school's phone/email or an actual support form. Merely silently recording a lead and promising an unspecified future callback is not enough to establish the “prompt, clear, and direct” requirement. Set callback expectations and offer a direct fallback. This is an application judgment, not a Meta-approved handoff design. [S3]

## 3. Shared app does not mean shared client WABA

### Strongest direct statement

Twilio's **WhatsApp Tech Provider program integration guide**, modified **October 9, 2026**, under “Create a subaccount for each customer,” says: [S7]

> “You must keep track of every customer business or brand and connect each one to a dedicated Twilio subaccount. WhatsApp doesn't allow senders from different businesses to be registered in the same WABA.”

This is an explicit first-party platform instruction attributing the rule to WhatsApp, not a sentence located in Meta's legal terms. Meta's own documentation independently establishes the client-ownership model below. No direct Meta clause with exactly Twilio's same-WABA wording was located; do not misattribute the quote. [S4–S6]

### Meta's documented account/partner model

Embedded Signup lets customers authenticate, accept terms, select/create their business portfolio and WABA, add a number **of their own or provided by the partner**, and grant the app asset access. The customer owns the assets and has full WhatsApp Manager access; the partner cannot restrict that access. A single app can receive all onboarded customer webhooks at one callback URL, so client-owned accounts do not require one app or deployment per school. [S4]

The **On-Behalf-Of (OBO) account ownership model is deprecated and no longer possible**. Meta's timeline gives September 29, 2025 as the last day to onboard OBO clients, October 1, 2025 as the transfer deadline and automatic migration batches through the end of 2025. Legacy provider-owned arrangements are not evidence that a new October 2026 platform can recreate them. [S5, S6]

The replacement, **partner-initiated WABA creation**, is for Solution Partners. The partner starts a request in Business Suite, the client accepts it in its own Suite, and the resulting account is owned by the client and shared with the partner. It is not silent API creation of school accounts owned by Fillthemat. Contractual authority to act for a school does not by itself bypass this documented flow. [S1 §1.2, S5]

Multi-Partner Solutions let multiple partners manage **a client's assets**, and share a Solution Partner's credit line. “Multi-partner” does not mean multiple unrelated clients represented by one provider-owned WABA. A shared billing relationship is distinct from shared business identity. [S9]

### How established platforms onboard clients

| Platform | Confirmed first-party onboarding structure | What this establishes |
| --- | --- | --- |
| Twilio ISV / Senders API | Customer creates/selects a portfolio and WABA via Embedded Signup; dedicated Twilio subaccount per client WABA; API can add later senders for the same client. | Explicit prohibition on different businesses' senders in one WABA. Senders API is not a client-authorization bypass. [S7] |
| Wati | Customer connects its WABA through Meta Embedded Signup, signs in with its Facebook account and needs admin access to its selected Business Manager. | Client business assets shared with the platform, not all tenants put on Wati's own WABA. The inference follows the described customer flow. [S11] |
| respond.io | Customer clicks Connect with Facebook, grants management/billing permissions, selects or creates a business portfolio and WABA, verifies a number and confirms sharing. | Same client authorization model. Removing respond.io as a partner does not delete the client's WABA. [S12] |

These official product docs prove such multi-business platforms exist, but not the proposed shared-WABA/no-Meta-owner-action design. Provider-specific quirks are not universal Meta rules; for example, respond.io's currency/555 guidance should not override Meta documentation. [S7, S11, S12]

### Important 2026 account-model caveat

Meta's **account-model evolution** documentation (released **May 1, 2026**) is marked **beta and subject to change**. It separates WhatsApp business identity/phone numbers (**WAAC**) from templates/billing/webhooks (**Messaging Account**). Existing `waba_id` values become Messaging Account IDs without changing their value. A WAAC is “always owned by the client or direct developer”; a Messaging Account may be client- or partner-owned. [S13]

Therefore distinguish “a provider-owned Messaging Account” from “a provider-owned school identity.” The new model does not establish permission to pool unrelated schools into the proposed legacy WABA or eliminate their authorization. The overview and some fetched onboarding pages still use legacy WABA wording; verify actual account rollout/eligibility with the selected partner before choosing IDs or billing assumptions. Do not claim all account types must forever be client-owned. [S4, S13]

## 4. Closest compliant design and unavoidable tradeoff

**Recommended planning baseline:** [S4, S7–S9]

1. Fillthemat completes Tech Provider verification/App Review and keeps one shared Meta app and webhook service.
2. Give each school a new Fillthemat-bought US virtual number; no coexistence and no owner's personal/business WhatsApp traffic.
3. The School Owner or another authorized school administrator completes Embedded Signup **inside Fillthemat**: authenticates with Meta, accepts terms, creates/selects school business assets and authorizes access. Pre-fill known school details.
4. Fillthemat automates registration/profile/routing after the authorization. Attach the school/allocation to its client account/token, not one universal WABA/token.
5. Use a Solution Partner / Multi-Partner Solution to handle Meta billing centrally and have Fillthemat absorb it contractually. Independent Tech Provider onboarding normally requires the client's payment method; a partner removes that requirement, not authentication or asset ownership.

**Lower-friction option to validate:** Meta documents a pool of partner **pre-verified numbers**, shared with a Multi-Partner Solution and claimed during Embedded Signup. This requires an approved Solution Partner and has 90-day verification/registration windows. It can remove the need for the owner to contact Fillthemat for an OTP; it does not remove the owner's signup/authorization. Twilio's October 9 guide says first-sender ESU v4 normally needs the OTP delivered to the user, while later SMS-capable senders can use its Senders API. Confirm which flow the chosen partner actually supports rather than promising zero OTP work. [S7, S14]

If “owners never take any Meta step” is absolute, no compliant, school-branded structure satisfying it was found. The decision must change to one-time owner authorization, receive explicit written Meta approval for an alternative, or defer WhatsApp. A genuinely Fillthemat-branded booking marketplace is a different business/use case to ask Meta about, not a proven loophole for the same school impersonation/ownership plan. [S1, S3–S6]

## 5. Consequences for the wayfinder map

These are recommendations to the parent session, not edits to existing issue bodies:

- **#144:** keep new virtual numbers per school and the audit view; overturn the shared-WABA portion. Reopen the school-owned-account/provider route decision without reopening coexistence.
- **#150:** “prove a relationship so Kaizen BJJ fits Fillthemat's account” is not the right main problem. Under client-owned school assets, validate the school's own identity/branding and naming review. A “by Fillthemat” suffix can describe a real affiliation, but display-name approval does not authorize cross-business WABA pooling. [S3, S4, S7, S15]
- **#135:** a one-click fully automatic first-time Enable WhatsApp flow is not established. It needs a Meta authorization step, cancellation/resume/reconnect behavior and school-account permission/eligibility failures before automatic provisioning. Use ESU v4; Meta's current docs warn v2 is deprecated **October 15, 2026**. [S4, S7, S11]
- **#145 / #141:** mechanical number API feasibility survives, but first-client onboarding/ownership is an additional gate, not just a capacity request. A transport number existing is not sufficient for live authorized messaging. [S4, S7]
- **#134, #140, #143:** client ownership, centralized partner billing and per-client template/account handling cannot remain dismissed solely because #144 chose a shared WABA. These need renewed scope decisions. [S4, S8, S9, S13]
- **#129 shared capacity assumptions:** with client-owned portfolios, 50 schools is no longer automatically 50 numbers under Fillthemat's own portfolio limit. Reassess limits for the chosen per-client model; Meta still permits provider-level suspension for client violations, so separation is not immunity. [S1 §5.3, S4, S13]
- **Human escalation / #146:** read-only auditing is compatible with not offering live takeover, but prospects still need an actual prompt/direct contact route. Audit retention does not authorize model training or waive privacy/deletion obligations. [S1, S3]

## 6. Remaining questions — bounded, not reopened policy fog

1. Which Solution Partner will support client-owned school accounts, Fillthemat-paid billing and rented US numbers with the least first-sender friction? Pilot ESU v4, including pre-filled data and pre-verified-number eligibility.
2. Does Meta or that partner give written confirmation of Fillthemat's bounded booking Assistant under §4.7? The documented rule supports it, but only Meta controls its classification.
3. Has the WAAC/Messaging Account beta reached Fillthemat's chosen accounts, and what are their actual ownership, template, limit and offboarding rules? Confirm before specifying schema/IDs.
4. What school phone/email/support form and callback expectation make human escalation prompt/direct? How are messaging opt-outs enforced across follow-ups?
5. Are school/Fillthemat permissions, prospect privacy notices and inference-vendor no-training settings adequate? Do not rely on the narrow exclusive-use fine-tuning exception without legal review.

## Sources and document dates

All URLs below were checked **2026-10-12**. “Not exposed” means the retrieved document did not provide a dependable modification date; access date is not a publication date. Meta legal/Help Center pages sometimes return login-only content. The full current terms were retrieved through the old legal URL with `lang=en_US`; display-name Help Center wording was available only in Meta's search-index excerpt and its developer page, so it is corroborative, not the basis of the ownership verdict.

- **S1 — Meta Terms for WhatsApp Business Platform**, last modified **2026-09-23**, §§1.1–1.3, 2.2, 4.1, 4.7, 5.3. Current canonical URL: <https://www.facebook.com/legal/Meta-Terms-for-WhatsApp-Business-Platform>. Full text retrieved at <https://www.whatsapp.com/legal/business-solution-terms?lang=en_US> (the requested Business Solution Terms URL now serves the renamed current terms).
- **S2 — Meta AI Provider pricing/use policy**, policy effective **2026-01-15**; market table updated **2026-05-12**; special charging changes **2026-05-13**: <https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/ai-providers>.
- **S3 — WhatsApp Business Messaging Policy**, last updated **2026-09-23**, §§1–3, 7 and opt-in best practices: <https://business.whatsapp.com/policy> (redirects to <https://whatsappbusiness.com/policy/>).
- **S4 — Meta Embedded Signup overview**, modification date not exposed in retrieved Markdown; current v2-deprecation warning **2026-10-15**: <https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview>.
- **S5 — Meta partner-initiated WABA creation**, modification date not exposed: <https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/partner-initiated-waba-creation/>.
- **S6 — Meta OBO ownership deprecation**, dated milestones **2025-03-24**, **2025-09-29**, **2025-10-01**, migration through end of **2025**: <https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/obo-model-deprecation>.
- **S7 — Twilio WhatsApp Tech Provider integration guide**, structured metadata `dateModified` **2026-10-09**; Part 3, first-sender OTP and “Create a subaccount for each customer”: <https://www.twilio.com/docs/whatsapp/isv/tech-provider-program/integration-guide>.
- **S8 — Meta Partners overview / Become a Tech Provider**, modification dates not exposed: <https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/overview> and <https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers>.
- **S9 — Meta Multi-Partner Solutions**, modification date not exposed: <https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/multi-partner-solutions>.
- **S10 — WhatsApp Business Platform Cloud API Terms**, last updated **2026-09-23**, §§1.1–1.3, 2.3: <https://www.facebook.com/legal/WhatsApp-Business-Platform-Cloud-API?locale=en_US>.
- **S11 — Wati Embedded Signup troubleshooting**, displayed date **2026-09-07**: <https://support.wati.io/en/articles/11462949-troubleshooting-embedded-signup-process-common-issues-and-how-to-resolve-them>.
- **S12 — respond.io WhatsApp API Quick Start**, article structured metadata modified **2026-08-28** (page also carries a **2026-10-09** timestamp): <https://respond.io/help/whatsapp/whatsapp-api-quick-start>.
- **S13 — Meta account-model evolution**, changelog says released **2026-05-01**; **beta**, planned phases H2 2026 / H1 2027 / H1 2028: <https://developers.facebook.com/documentation/business-messaging/whatsapp/account-model-evolution/>.
- **S14 — Meta pre-verified phone numbers**, modification date not exposed; requirements/90-day windows: <https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/pre-verified-numbers>.
- **S15 — Meta display-name docs and Business Help Center**, modification dates not exposed: <https://developers.facebook.com/documentation/business-messaging/whatsapp/display-names/> and <https://www.facebook.com/business/help/757569725593362>. Meta's indexed Help Center excerpt says to indicate an unclear company/brand relationship using “by [company name]”; this is a naming guideline, not an account-ownership exception.
