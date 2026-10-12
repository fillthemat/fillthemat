# Support-agent channel infrastructure: market and customer needs

Research for [#206](https://github.com/fillthemat/fillthemat/issues/206), informing the core-platform question in [#204](https://github.com/fillthemat/fillthemat/issues/204).

**As of:** October 12, 2026. **Method:** public first-party product pages, developer documentation, and vendor-published customer evidence. This is a capability assessment, not a market-share estimate or a tested integration benchmark. “Not established” means the reviewed public sources do not establish a capability, not that the vendor cannot supply it privately. Product pages describe vendor claims; documentation provides stronger evidence of the actual integration contract. Recommendations below are hypotheses to validate with customers.

## Answer in brief

The space is crowded on both sides: hosted support agents already ship with channels, handoff, and analytics, while helpdesks and communications platforms already accept external agents. **“Bring your agent, connect many channels, manage centrally” is not an unoccupied category.** Pylon explicitly documents BYO agents; Chatwoot documents external AgentBots; Zendesk supplies bot/human switchboard APIs; Twilio Agent Connect supplies unified callbacks, conversation context, and human escalation. Bird now also documents routing inbound messages to external managed agents. [1][11][14][15][17][20]

The examples need separating. **Pylon sells support infrastructure; Wispr Flow buys it.** Pylon's Wispr case study describes Slack, Teams, email, and in-app support plus AI-assisted human operations, not Wispr reselling a multichannel support-agent runtime. **The supplied Thea URL currently describes a private-mortgage AI co-broker built around inbox/email attachments**, not a general support-agent vendor. Its underlying agent/channel architecture is not publicly established. [6][7]

The plausible opening is narrower: **an embedded, runtime-neutral control plane for agent builders serving many customer tenants**, preserving existing inboxes and channel accounts while enforcing conversation ownership and exporting a complete operational evidence trail. That combines existing capabilities rather than inventing new ones; it earns a place only if it removes measurable cross-vendor integration and operations work.

## 1. How delivery works today

Three patterns explain most of the reviewed evidence:

1. **Helpdesk owns the channels and conversation record.** An internal or external agent consumes issue/message events and posts replies through the helpdesk. Human handoff changes assignment/control within the existing inbox. Pylon BYO, Chatwoot AgentBot, and Zendesk switchboard fit this pattern. [1][14][15]
2. **Hosted agent overlays an existing support stack.** The provider supplies intelligence and workflow tooling; helpdesk/contact-center connectors deliver messages, actions, and escalation. Fin works with existing helpdesks; Decagon describes Five9 as the engagement/routing fabric and Decagon as the agentic brain. Sierra supplies its own agent-authoring and deployment platform with contact-center handoff. [9][10][11]
3. **Communications infrastructure feeds an application-owned agent.** The customer owns agent logic and integrates transport, context, and routing primitives. Twilio TAC normalizes voice/messaging into one callback. Bird offers REST APIs, webhooks, and selected managed-agent destinations. Human workspace, business policy, and agent evidence may still require additional systems. [17][18][19][20]

These are distinct contracts. Calling a hosted agent API, writing agent workflows in a vendor SDK, supplying MCP tools, and connecting an arbitrary external agent are **not interchangeable meanings of BYO**.

## 2. Comparison

Channel lists below distinguish a platform's channels from proof that every agent feature works on every channel. Confirm plan, rollout status, country, and channel-specific limits before procurement.

| Company/product | Hosted versus BYO | Documented delivery/channels | Handoff | Audit/analytics | Developer surface |
| --- | --- | --- | --- | --- | --- |
| **Pylon** | Native hosted support agents **and explicit external BYO**. | Platform: Slack, Teams, Discord, Telegram, WhatsApp, SMS, web chat, email, forms, portal, phone; Google Chat is Enterprise. This is not proof of AI-agent parity across them. [1][2] | Assign agents manually or through triggers; escalation reassigns the issue. [3] | Agent issue logs, outcomes/reasons, funnel/CSAT metrics; admin audit events with actor, time, object, optional IP, CSV/API export. Full audit history is Enterprise; otherwise 30 days. [4][5] | Issue/message webhooks + reply/metadata APIs; Skills delegate via MCP/custom API actions; third-party agent setup through account rep. [1] |
| **Wispr Flow** | Dictation product and **support-platform customer**, not an established seller of BYO support-agent infrastructure. | Pylon customer story documents Slack, Teams, email, in-app chat. [6] | Human support teams and Pylon workflows; exact autonomous-agent escalation setup not established. [6] | Story cites categorization, AI analytics, tiered SLAs, reply drafting, knowledge-gap detection. No independent Wispr support-agent audit product established. [6] | No public support-agent distribution API established by the reviewed case study. |
| **Thea at trythea.ai** | Vertically packaged mortgage co-broker; hosting architecture and BYO support not established. | Email/inbox and attachments; website deal-entry interface. No general multichannel support contract established. [7] | Organizing files/following up is advertised; bot-to-human ownership API not established. [7] | No public operational audit or support-analytics interface established. | No public developer API established on the reviewed homepage. [7] |
| **Intercom Fin** | Hosted Fin; can be invoked by another agent or used with another helpdesk. This is composability, not proof of an arbitrary BYO runtime hosted by Fin. [8][9] | Web/iOS/Android Messenger, email, phone, WhatsApp, Facebook Messenger, Instagram, SMS, Slack; overview also describes Discord. Voice remains sales-gated in the reviewed channel guide. [9][21] | Workflows/inbox or existing helpdesk; API escalation has distinct Helpdesk and Fin-for-Platforms semantics. [8][9] | Answer inspection shows sources/settings; performance, involvement/resolution, CX scoring, topics, AI/human reporting. API includes source citations and CSAT events/submission. Immutable cross-runtime audit not established by these sources. [8][9] | Public versioned Fin Agent API: capabilities, ask, start/reply, procedures, escalate, CSAT; signed webhooks and optional SSE. Access/SSE require approval. [8] |
| **Decagon** | Hosted agents configured with workflows, tools, APIs/MCP. An arbitrary external runtime BYO contract is not established by reviewed sources. [10][22] | First-class chat/email/voice; helpdesk/contact-center integration, including Zendesk, Intercom, Salesforce, Five9, Amazon Connect, RingCentral, and SIP. Five9 announcement also discusses SMS and broader engagement; verify actual connector/channel parity. [10][22] | Helpdesk routing/call transfer; Five9 gets transcripts, customer data, and intent. [10][22] | Watchtower monitors AI/human interactions against custom criteria, filters by channel/CSAT/outcome, scores rubrics, and drills into transcripts. Five9 announcement claims reasoning traceability; immutable audit/export contract not established. [10][23] | Prebuilt connectors, custom tools/API actions, MCP, SIP. These establish integration extensibility, not a public vendor-neutral agent-hosting API. [22] |
| **Sierra** | Hosted agent platform with Agent SDK/Studio authoring. SDK lets customers build logic inside Sierra; arbitrary externally hosted agent attachment is not established. [11] | Chat/web/mobile, voice, email, WhatsApp, Apple Business Chat, SMS; current channels page also advertises ChatGPT app publishing via MCP. [11][12] | Routes to contact-center staff with generated summary. [11] | API-call/logic traces, simulations, CSAT/case resolution, tags, experiments, knowledge/system-access inspection, monitoring/alerts. [11][13] | Agent SDK, composable skills, system integrations and deployment tooling; public product page is not a complete REST/webhook contract. [11][12] |
| **Zendesk messaging / Sunshine Conversations** | Programmable routing for first-party, third-party, and custom external bots alongside human Agent Workspace. [14] | Messaging channel integrations; reviewed switchboard gives web-widget and WhatsApp examples and channel-specific default responders. Do not treat it as one API for all Zendesk email/voice traffic. [14] | `passControl`, `releaseControl`, metadata, default/next responder; one active integration. Offer/accept exists but Zendesk systems do not accept that flow. [14] | Conversation/control/delivery events and history; support reporting lives in the surrounding stack. External LLM/tool decision audit is not established by switchboard docs. [14] | Conversation REST API + event webhooks + custom/OAuth integrations. Ownership is signaling, **not a write-permission boundary**. [14] |
| **Chatwoot** | Hosted or self-hosted inbox, native Captain AI, **external AgentBot**. [15][16] | Web chat, email, WhatsApp, Messenger, Instagram, TikTok, Telegram, LINE, SMS, voice; X is marked coming soon. Slack is listed as an integration, not evidence of Slack-Connect channel parity. [16] | Bot-owned conversations start `pending`; switch to `open` for human, back to `pending` for bot. [15] | Conversation/team/agent/inbox/CSAT reports; account audit logs advertised. External model/tool traces remain separate from an inbox activity log. [16] | AgentBot webhooks + message/status REST APIs, webhook-verification secret. [15] |
| **Twilio Agent Connect + Orchestrator/Memory** | Explicit middleware for **application-owned LLM agents**, independent of model provider. [17] | Unified callback for voice, SMS, WhatsApp, RCS, chat; voice through Conversation Relay. Email/Slack/Teams are not listed TAC channels in the reviewed guide. [18] | Built-in Studio handoff tool; voice transfers after final response, digital starts Studio execution; payload carries conversation/profile/memory IDs and custom attributes. [19] | Conversation context/history and optional intelligence events; full external model/tool audit and support outcomes are not established as a single TAC dashboard in reviewed docs. [17][18] | Python/TypeScript SDK, callbacks, webhooks/WebSockets, provider integrations. TAC explicitly **not PCI compliant or HIPAA eligible**. [17][18] |
| **Bird** | Unified communications APIs for custom applications; selected external managed-agent destinations. The latter currently supports Claude Managed Agents and Grok Bot, not every arbitrary runtime. [20][24] | REST resources include email, SMS, WhatsApp, Apple Messages, voice; managed-agent inbound routing covers WhatsApp/SMS/Apple Messages/agent mailbox events. [20][24] | Routing-to-agent is documented; a complete bot/human ownership contract is not established by reviewed routing/webhook pages. | Delivery receipts/failures, signed events, attempt logs/replay. These are transport evidence, not complete agent decision/outcome audit. [20][25] | REST/OpenAPI, generated SDKs, CLI/MCP, webhooks; custom runtimes can consume ordinary HTTPS event callbacks. [24][25] |

## 3. Important integration details hidden by “omnichannel”

### Pylon already supports the proposed basic BYO flow

Its BYO documentation explicitly says to listen for new issues, messages, and other ticket events and post replies or metadata changes through the API. Skills can combine Pylon orchestration with another agent via MCP/custom actions. This is direct competition for “one place to run your agent over support channels,” not merely a proprietary bot with no extensibility. [1]

Two qualifications matter:

- The platform channel inventory does not establish agent parity: Pylon's outcome definitions explicitly include escalation when an agent cannot respond on a channel. [2][4]
- Audit logs establish administrative/action accountability; issue logs establish agent outcome visibility. Neither source proves complete traces for an independently hosted agent's private model/tool execution. That requires external instrumentation. [4][5]

### Fin is a composable hosted agent, not just a chat widget

The API lets an orchestrating agent retain control and call Fin as a tool, or hand Fin an entire turn through `/fin/start`. It uses external conversation IDs, user identity, history/attributes, attachments, async status/reply events, and HMAC-signed webhooks; optional SSE delivers the same event schemas. API behavior is versioned: intermediate `replying` events have different semantics before 2.16. [8]

Its human escalation is not a universally identical “handoff”:

- On Intercom Helpdesk, default escalation creates a **new** Helpdesk conversation with a summary/internal context note. A matching Operator Workflow can replace that default. The original agent conversation's assignment/open state does not automatically change.
- On Fin for Platforms, an existing conversation ID is required; the platform receives escalation status and handles its own human desk. The optional `context` is **not surfaced** to that platform through escalation events.
- `complete` means Fin has returned control, not necessarily that the support conversation is closed or the customer problem is solved. [8]

These are real opportunities for an adapter to remove integration mistakes, but the API itself is already substantial competition.

### Existing handoff primitives do not eliminate ownership races

Zendesk warns that switchboard active/standby status is signaling rather than permissions: all integrations can still write. Its `next` handoff has different idempotency behavior depending on integration-scoped versus app-scoped credentials. It also warns that offering control to Agent Workspace will never be accepted; use `passControl`. Chatwoot uses conversation status as its bot/human handoff signal. [14][15]

Twilio already supplies handoff context/routing through Studio. Its documentation even calls out duplicate voice messages when TAC hydration and voice capture rules are both enabled. Bird states that retrying agent delivery can start another agent run; ordinary events are at-least-once and unordered. [19][20][25]

**Inference:** a neutral platform can add value by enforcing single-writer ownership, rejecting stale agent replies, reconciling downstream control changes, and making retries safe. It cannot honestly differentiate merely by having an `escalate()` method.

### Resolution statistics are not interchangeable

Pylon counts issues, not messages/conversations. Its “Resolved” includes a teammate or trigger closing an issue while it remains assigned to an agent, and a 24-hour customer drop-off can count as resolved without changing issue status. Different dashboard charts/tiles use different denominators. Fin has API lifecycle states and separately bills outcomes; `complete` is not proof of resolution. [4][8]

**Inference:** independent analytics should preserve original definitions and report confirmed resolution, assumed resolution/drop-off, reopen/recontact, and human-assisted completion separately. Aggregating vendor “resolution rate” numbers without denominators and attribution rules would be misleading.

## 4. How crowded is it?

This is a qualitative assessment from documented feature overlap, not evidence of market concentration or vendor revenue.

| Layer / proposed promise | Crowding assessment | Why |
| --- | --- | --- |
| Hosted support agent with workflow builder, channels, handoff, analytics | **Very crowded in the reviewed set** | Pylon, Fin, Decagon, Sierra already cover it; Sierra/Decagon/Fin also supply testing/inspection/optimization. [3][9][11][13][23] |
| BYO bot attached to a central inbox | **Already established** | Pylon BYO, Chatwoot AgentBot, Zendesk switchboard. [1][14][15] |
| Unified channel transport feeding arbitrary agent logic | **Already established; increasingly agent-aware** | Twilio TAC supplies unified callbacks/context/handoff; Bird supplies APIs/webhooks and selected managed-agent destinations. [17][18][19][20][24] |
| Neutral control/evidence layer across multiple helpdesks, transports, runtimes, and customer tenants | **Plausible but unproven opening** | Reviewed sources do not establish one portable contract covering all of these boundaries. That absence is not proof that competitors lack private/enterprise support or that customers will pay for another layer. |

**Buyer implications (inference):**

- **A Wispr-like support operator** mainly wants an effective support stack: routing, customer tiers/SLAs, migration, knowledge, reporting, and team onboarding. The case study is evidence for those pains, not for demand for a new agent-runtime abstraction. A neutral platform must improve their existing Pylon/Fin stack rather than ask them to rebuild it. [6]
- **A Thea-like vertical agent builder** may need inbox ingestion, attachment safety, customer permissions, long-running workflows, approvals, and an inspectable work record more than a dozen chat adapters. This is a hypothesis drawn from the advertised mortgage workflow, not a verified purchase requirement. [7]
- **A Pylon/Decagon/Sierra-like platform vendor** already owns much of the customer relationship and operational layer. Treating it as a likely buyer of a generic channel platform is speculative without evidence that connector upkeep or tenant provisioning is worth outsourcing.
- **An independent agent developer deploying into many customers' existing stacks** is the most credible initial interview target: the problem sits across helpdesk/channel boundaries rather than inside one vendor's already capable product.

## 5. What a customer could need beyond what exists

The following are **candidate requirements**, not claims that no competitor offers them. Prioritize measured integration/operations pain over a longer feature checklist.

| Candidate requirement | What already exists | Potential incremental value and validation |
| --- | --- | --- |
| **Tenant-scoped provisioning and credentials** | Vendors supply their own workspace/channel setup and APIs. [1][14][24] | One embedded onboarding flow for an agent builder's customer tenants, least-privilege credentials, permission checks, rotation/revocation, regional isolation, connector health. Validate deployment time and recurring support burden across multiple inbox vendors. |
| **Runtime-neutral hosted/BYO driver** | Pylon and Chatwoot accept external bots; Twilio accepts application-owned agents; Fin exposes hosted capabilities. [1][8][15][17] | The same event/action contract for platform-hosted agents and external HTTP/SDK agents, with no compulsory prompt/model migration. Validate that customers actually need runtime switching, not just one reliable integration. |
| **Canonical identity and conversation mapping** | Helpdesk conversation records, Zendesk control/history, Twilio context/memory, Pylon issue classification. [2][14][17] | Map tenant, customer, helpdesk ticket, channel thread, session, and agent run without merging unrelated people or leaking context. Preserve external IDs/raw provenance. Validate repeat contacts and identity errors; do not assume a phone number is verified identity. |
| **Enforced handoff and safe effects** | Assignment/status/switchboard/Studio transfer already exist. [3][14][15][19] | Single-writer lease/control version, cancel pending work, fail closed after human takeover, approvals for sensitive actions, idempotent side effects, reconciliation with inbox ownership. Validate bot/human collisions and duplicate-action incidents. |
| **Portable operational evidence** | Pylon audit + outcomes, Fin sources/settings, Sierra traces, Decagon QA, Bird delivery logs. [4][5][8][9][11][13][23][25] | Correlate inbound event → policy/knowledge version → agent run/tool result → approval/handoff → delivery receipt across providers, exportable to customer systems. Validate incident reconstruction and compliance evidence time. Do not promise access to hidden model reasoning. |
| **Comparable outcome/cost analytics** | Strong vendor-native reports already exist, but definitions differ. [4][8][9][13][16] | Defined denominators/cohorts, confirmed versus assumed resolution, recontact/reopen, accepted handoff and wait time, per-tenant/channel/runtime-version latency and cost. Validate whether cross-vendor reporting changes an actual decision. |
| **Channel-capability and policy enforcement** | Fin documents different tone/media/reply-window behavior; Twilio separates real-time voice and webhook messaging. [18][21] | Discover capabilities and reject/translate unsupported actions; preserve threading, attachment access, consent/template windows, voice interrupts, and channel-specific deadlines. Validate against real failed sends, not a logo wall. |
| **Failure isolation and supportable integrations** | Signed callbacks, retries, replay, idempotency and handoff tools already exist. [8][14][19][24][25] | Per-tenant queues/limits, durable deduplication, dead-letter inspection, replay without repeating external effects, pause/kill switch, fallback human routing, sandbox fixtures. Validate outage recovery effort and acceptable failure behavior. |

### Suggested API shape for customer discovery

This is an illustrative interface, **not an implementation spec**. The primary abstraction should be a controlled conversation with transport adapters and interchangeable agent drivers, not a generic prompt endpoint.

```text
Tenant / Connection / AgentDriver / Conversation / Message / Run / Handoff / AuditEvent

POST /v1/connections                    tenant-scoped channel/helpdesk authorization
POST /v1/agents                         hosted config or external driver + capabilities
GET  /v1/conversations/{id}             state, owner/control_version, external references
POST /v1/conversations/{id}/messages    content + idempotency key + expected control_version
POST /v1/conversations/{id}/handoffs    target, reason, transcript/run refs, collected fields
POST /v1/conversations/{id}/resume      explicit human-to-agent transfer
GET  /v1/runs/{id}                      status, tool/effect receipts, evidence references
GET  /v1/audit-events                   tenant-scoped cursor/export
GET  /v1/analytics/outcomes             defined metric version, cohort, denominator

Outbound signed events:
message.received | run.requested | message.delivered | message.failed
ownership.changed | handoff.requested | handoff.accepted | conversation.closed
```

- **External agent driver:** receive `run.requested` containing stable event/run IDs, tenant/conversation IDs, message/content references, authenticated identity claims, available tools/channel capabilities, deadline, and control version. Submit messages/actions referencing that run; optionally stream for channels that support it. Platform checks ownership/policy before executing effects.
- **Hosted driver:** run the customer's agent specification/tool loop behind exactly the same contract. Platform-hosted and externally hosted drivers must report instrumented evidence to the same schema; private BYO internals cannot be inferred automatically.
- **Delivery contract:** explicitly at-least-once events; distinguish event ID from attempt ID, acknowledge durable acceptance, deduplicate effects, provide failure/replay tooling. Preserve provider IDs and capability-specific fields rather than flattening everything into a string.
- **Handoff contract:** distinguish requested, accepted, and failed transfer, with timeout/fallback. A handoff is an ownership transition, not just a summary or ticket creation. Scope enforcement to platform-mediated writes; reconcile/block or alert on out-of-band downstream changes.
- **Security/evidence:** tenant-scoped authorization, expiring attachment access, redaction/retention/deletion policies, append-only operational events subject to lawful data lifecycle, optional SIEM export, versioned policy/knowledge/agent metadata. Audit means observable inputs/actions/results/approvals, not private chain-of-thought.

**Channel priority (hypothesis):** start with web/in-app chat and email, plus one existing helpdesk connector. Add Slack/Teams only if B2B design partners require them; WhatsApp/SMS if their customer geography/workflow requires them. Defer voice until an actual customer justifies its interruption/latency/telephony complexity. Pylon and Fin already serve messaging-heavy B2B support, and Twilio already serves voice/SMS/WhatsApp agent transport, so no single channel addition is itself a moat. [2][18][21]

## 6. Recommendation and remaining evidence gaps

**Do not position the core as “omnichannel agents in one dashboard.”** Position and validate a specific outcome: “deploy your existing agent into multiple customers' existing support stacks, with reliable ownership and an exportable record of every operational action.” Hosted mode can lower onboarding friction; runtime neutrality and embedded multi-tenant operations would be the reasons to buy.

Before investing, interview independent/vertical agent builders and support operators separately:

1. Which two or more inbox/transport vendors must one agent integrate with today? Ask for actual integration diagrams and recent failure incidents.
2. How long does onboarding each customer tenant take, and what ongoing connector support work could be removed? What would they pay to avoid it?
3. What exactly happens when a human takes over, an agent replies late, or a webhook retries a refund/action? Who enforces ownership?
4. Which audit/export/retention requirements are blocked today, versus simply available on a higher incumbent plan?
5. Which outcome comparison or cost allocation is impossible today, and what decision would it change?
6. Why not use Pylon BYO, Chatwoot, Zendesk switchboard, Twilio TAC, or Bird directly? Demand a concrete gap rather than enthusiasm for abstraction.

**Go/no-go evidence (proposed):** recruit multiple independent design partners with the same cross-vendor problem, demonstrate two end-to-end adapters with identical driver/ownership/evidence semantics, and measure customer-onboarding effort and incident-reconstruction time against their current setup. If their needs fit one incumbent stack, build an integration or vertical workflow rather than a general platform.

Open questions requiring vendor/customer confirmation:

- Whether Thea was intended to refer to an older/different product; do not attribute other “Thea” companies' features to this URL.
- Whether Wispr currently runs autonomous Pylon agents; its published story primarily establishes copilots/automation and human support operations.
- Decagon/Sierra public versus customer-gated developer contracts, arbitrary BYO runtime support, tenant provisioning, quotas, and evidence export guarantees.
- Per-channel agent parity and rollout status; Fin Voice access is explicitly limited, and “platform has phone” is not proof that a specific Pylon agent can autonomously answer calls. [4][21]
- Exact pricing, availability, residency, compliance scope, support SLAs, and portability at negotiated plans. Twilio TAC's published HIPAA/PCI exclusions are an explicit constraint, not evidence that another proposed platform is automatically compliant. [17]
- No hands-on implementations, purchasing interviews, or independent verification of vendor performance claims were conducted. Wispr's case study contains differing headcount/growth descriptions; use it for workflow/pain evidence, not causal productivity or staffing estimates. [6]

## Primary sources

All sources accessed October 12, 2026. Live pages can change; dates below are publication/update dates where the page provides them, not universal launch dates.

[1]: https://docs.usepylon.com/pylon-docs/agents/support-agent/build/bring-your-own-agent
[2]: https://docs.usepylon.com/pylon-docs/support-workflows/omnichannel-support
[3]: https://docs.usepylon.com/pylon-docs/agents/support-agent/deploy
[4]: https://docs.usepylon.com/pylon-docs/agents/support-agent/monitor-and-iterate
[5]: https://docs.usepylon.com/pylon-docs/platform/audit-logs
[6]: https://www.usepylon.com/case-study/wispr-flow
[7]: https://trythea.ai/
[8]: https://developers.intercom.com/docs/guides/fin-agent-api
[9]: https://www.intercom.com/help/en/articles/7120684-fin-ai-agent-explained
[10]: https://decagon.ai/blog/decagon-and-five9
[11]: https://sierra.ai/product/agent-sdk
[12]: https://sierra.ai/product/channels
[13]: https://sierra.ai/product/insights
[14]: https://developer.zendesk.com/documentation/conversations/messaging-platform/programmable-conversations/switchboard/
[15]: https://www.chatwoot.com/hc/user-guide/articles/1677497472-how-to-use-agent-bots
[16]: https://www.chatwoot.com/features
[17]: https://www.twilio.com/docs/conversations/agent-connect
[18]: https://www.twilio.com/docs/conversations/agent-connect/channels
[19]: https://www.twilio.com/docs/conversations/agent-connect/escalate-to-human-agent
[20]: https://bird.com/docs/ai/route-messages-to-an-agent
[21]: https://www.intercom.com/help/en/articles/13377077-choose-channels-to-deploy-fin-ai-agent
[22]: https://decagon.ai/product/integrations
[23]: https://decagon.ai/product/watchtower
[24]: https://bird.com/docs/api
[25]: https://bird.com/docs/guides/webhooks

1. [Pylon: Bring Your Own Agent][1] — explicit first-/third-party integration approaches.
2. [Pylon: Omnichannel Support][2] — channel inventory and issue classification for ongoing chats.
3. [Pylon: Deploy][3] — assignment/triggers and escalation.
4. [Pylon: Monitor & Iterate][4] — issue logs and detailed outcome/metric definitions.
5. [Pylon: Audit Logs][5] — captured events, retention, CSV and API export.
6. [Pylon: Wispr Flow customer story][6] — vendor-published channel, migration, workflow, and customer-pain evidence.
7. [Thea homepage][7] — current mortgage/inbox product identity.
8. [Intercom: Fin Agent API][8] — orchestration endpoints, event schemas, access/version limits, escalation and CSAT semantics.
9. [Intercom: Fin AI Agent explained][9] — product, helpdesk integration, testing/answer inspection and analytics.
10. [Decagon and Five9 integration][10] — published June 15, 2026; existing contact-center fabric, SIP and context-rich handoff.
11. [Sierra: Agent SDK][11] — authoring, simulations/debugging, omnichannel deployment and contact-center handoff.
12. [Sierra: Channels][12] — voice, messaging, email, live assist, and ChatGPT publishing.
13. [Sierra: Insights][13] — reporting, experiments, monitoring and agent-action auditing.
14. [Zendesk: Switchboard][14] — custom bots, conversation control, idempotency, metadata and enforcement limitations.
15. [Chatwoot: How to use Agent bots][15] — updated May 19, 2026; external bot webhooks, API replies, human handoff.
16. [Chatwoot: Features][16] — channels, deployment models, reporting, audit logs and integrations.
17. [Twilio Agent Connect][17] — page modified May 5, 2026; BYO middleware and compliance exclusions.
18. [Twilio TAC: Channels][18] — page modified May 5, 2026; callback contract, channel list, voice interruptions and memory.
19. [Twilio TAC: Escalate to a human agent][19] — page modified July 17, 2026; Studio handoff and duplicate-capture warning.
20. [Bird: Route messages to your AI agent][20] — managed-agent destinations, supported inbound events and retry behavior.
21. [Intercom: Choose channels to deploy Fin AI Agent][21] — May 18, 2026; channel inventory, voice access limits, channel-specific restrictions.
22. [Decagon: Integrations][22] — helpdesk/contact-center adapters, API actions, MCP and SIP.
23. [Decagon: Watchtower][23] — custom monitoring criteria, rubric scoring, dashboards and transcript drilldown.
24. [Bird: API introduction][24] — REST/OpenAPI/SDK conventions, product/channel resources and idempotency.
25. [Bird: Webhooks & events][25] — signed at-least-once unordered delivery, attempt logs and replay limitations.
