# Core agent platform: build vs adopt

Research for [#205](https://github.com/fillthemat/fillthemat/issues/205), against [map #204](https://github.com/fillthemat/fillthemat/issues/204). Checked **12 October 2026**. Planning only; no extraction, dependency change, or Poppy migration is proposed here.

## Answer

**Adopt the commodity layers; build only a thin, domain-neutral conversation control plane if product #2 actually needs it.** Keep AI SDK for the hosted driver, trial Chat SDK for channel transport, adopt A2A's protocol/SDK for remote agents, retain OTel/Langfuse for tracing, and evaluate Workflow as the execution backend rather than inventing a workflow engine. The potential proprietary core is driver routing, tenant/identity/conversation ownership, durable inbox/outbox policy, human takeover, and authoritative audit—not another tool loop. Mastra is the strongest integrated framework contender and already supports externally owned loops; Chatwoot is the strongest whole-product contender and already supports BYO bots plus human takeover. Neither should be dismissed merely because we currently have custom code. [S1–S10, S15–S17]

**For the map's ladder: conditional rung 1 (`src/core/`), not a workspace or published framework.** This research identifies integration gaps but does **not** prove the map's “no existing framework covers the core well enough” gate. First compare a small Chatwoot integration and a Chat SDK + AI SDK + Workflow composition with the same product-#2 acceptance cases. If an existing product meets them with small adapters, adopt it and choose no-go on a new platform. Otherwise, an incremental in-repo boundary is justified; distribution and public API design remain separate decisions. This is a recommendation, not an edit to #204.

## Scope and terminology

The target is a platform where support-agent companies plug in **their existing agents** and manage them across channels, not just an app that selects a different model. #204 and its decision from [#208](https://github.com/fillthemat/fillthemat/issues/208) require hosted **and** BYO drivers. A provider abstraction is therefore insufficient evidence of BYO support. [S1]

- **Agent definition/tool loop:** instructions, tools, loop control, approvals, model access. May belong entirely to the external agent.
- **Driver:** the platform-facing execution contract for a hosted loop, embedded SDK, or remote service. It must handle reply/events, cancellation, resumption, and opaque external session/task IDs without importing that agent's prompt or tool definitions.
- **Channel:** web or WhatsApp customer transport; **A2A** is a remote-agent interoperability protocol, not a substitute for either channel.
- **Conversation state:** canonical identities, ordered transcript, ownership, handoff and delivery state. Distinct from model memory, workflow checkpoints, and adapter locks/caches.
- **Durable delivery:** accepted input survives crashes; duplicate input is reconciled; outbound intent survives until success/failure/unknown is recorded; ordering, retries and dead-letter recovery have explicit owners.
- **Handoff:** human/operator takeover of a conversation, including stopping stale agent output and replying through the same channel. Agent-to-agent delegation and tool approval are useful primitives, but are not this feature.
- **Audit:** retained authoritative records of input, decisions, actions, ownership transitions and delivery outcomes with provenance. Trace dashboards and workflow logs are supporting views, not automatically the source of truth.

The last four definitions are evaluation criteria inferred from #204's unsolved questions and the existing retention/tracing ADRs; they are **not** claims that the map has already agreed a detailed contract. [S1, S17]

## Coverage matrix

**Native** = documented first-party capability; **partial** = useful primitives but platform integration/policy still required; **build** = no complete capability established in the reviewed sources. “Build” does not assert that an extension is impossible. Runtime recovery never implies exactly-once effects at a messaging provider.

| Candidate | Definition / loop | Hosted + BYO drivers | Web / WhatsApp / A2A | State | Durable delivery | Human takeover | Tracing / authoritative audit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Chat SDK** | Compose an external loop | Any callable handler; driver lifecycle is ours | Native / native / build | Native adapter state/history; canonical model partial | Partial: locks, dedupe, bounded queues; compose Workflow | Partial: durable approvals, not operator ownership | Structured logs/history; platform audit build |
| **AI SDK** | Native `ToolLoopAgent` | Hosted loop native; external-agent driver build | Native web UI protocol / compose / compose | Caller-owned transcript | Build without execution backend | Tool approvals; takeover build | Telemetry/hooks; audit build |
| **Mastra** | Native agents/tools | Native SDK-agent wrappers; remote A2A | Chat SDK integration / Chat SDK integration / native | Memory/storage + workflows | Partial: beta durable agents; delivery outbox still ours | Suspend/resume/approval; operator inbox build | Native tracing/exporters; audit policy ours |
| **Inngest AgentKit** | Native agents/networks/router | Model providers; arbitrary BYO lifecycle not established | App integration / app integration / app integration | Network state/history | Inngest execution; message semantics ours | HITL example/event wait; inbox build | Run tracing; canonical audit ours |
| **Workflow + `WorkflowAgent`** | Native durable AI SDK loop | Hosted native; arbitrary HTTP/SDK work inside steps | Compose AI SDK/Chat SDK / compose / compose | Run/step/stream persistence, not platform identity | Native execution/retries; inbox/outbox policy ours | Durable approval/hooks; takeover build | Workflow inspection; audit policy ours |
| **LangGraph JS** | Native graph orchestration; loop can be composed | Any callable graph node; contract still ours | Integrate / integrate / integrate | Native checkpoints/store | Native recovery with persistence; channel delivery ours | Interrupts/state edits; operator inbox build | LangSmith integration; canonical audit ours |
| **OpenAI Agents JS** | Native loop/tools/agent handoffs | Custom models ≠ arbitrary BYO agent | Integrate text UI / integrate / integrate | Native sessions and resumable run state | Persist/resume primitives; delivery backend ours | Tool HITL; operator takeover build | Native traces; audit ours |
| **Temporal** | Compose AI SDK or external calls | Activities can call hosted/BYO services | Integrate / integrate / integrate | Durable execution history | Native orchestration; provider idempotency/outbox ours | Signals/waits; operator inbox build | Execution history/visibility; transcript/audit policy ours |
| **Chatwoot** | External AgentBot or product AI features | Native external bot webhook/API seam | Native / native / separate integration | Native customer/inbox/conversation records | Product delivery/jobs; our stronger contract unverified | Native pending ↔ open human handoff | Product records; tool/provenance and retention fit unverified |

Matrix sources: Chat SDK [S2–S5]; AI SDK [S6]; Mastra [S7–S9]; AgentKit [S10]; Workflow [S6, S11]; LangGraph [S12]; OpenAI [S13]; Temporal [S14]; Chatwoot [S15].

## Candidate findings and tradeoffs

### Chat SDK: adopt transport, not the platform's delivery guarantee

The official adapters now include **web and WhatsApp Business Cloud**. Web speaks the AI SDK UI stream protocol and delegates authentication to our `getUser` implementation. WhatsApp supports signed webhooks, approved templates, media, phone/BSUID identity aliases and rotation. These are meaningful commodity capabilities: “we need WhatsApp” is no longer a build argument. [S2, S3]

State adapters include Redis and PostgreSQL. User history supports cross-platform identity resolution, with count eviction disabled and no TTL if configured appropriately. But replies are appended to user history only when the caller does so; an identity resolver failure logs a warning and dispatches without user-history persistence. A durable history backend is useful, not proof that every interaction and side effect was atomically audited. Tenant scoping and identity linking policy still belong to us. [S4]

The concurrency defaults are unsuitable as the acceptance contract for a lossless inbox: **`drop` discards an overlapping message with `LockError`**; `queue` dispatches the latest message with intermediate messages in `context.skipped`; default queue capacity is 10, default eviction is drop-oldest and default entry TTL is 90 seconds. Burst/queue can preserve logical turn context if the handler consumes it, but are not a complete crash-recoverable delivery system. Persist acceptance before scheduling/coalescing and test adapter integration rather than assuming a Redis queue is an outbox. [S5]

Chat SDK also has `chat/workflow` durable approvals, including approver restrictions. That narrows the HITL work; it still does not implement conversation takeover, operator assignment or suppression of late BYO responses. Lock-in is mainly its Thread/Message/Card shapes and adapter state API; hide these behind platform-facing transport boundaries. [S2, S5]

### AI SDK: keep the hosted implementation

`ToolLoopAgent` supplies the loop, tools and model-provider abstractions, and the UI protocol already used by this repo. Different model providers do not give product #2 a seam for an external agent that owns its own loop. Keep AI SDK **inside one driver**, not as the universal public agent definition. A2A/HTTP/SDK drivers should not have to translate their private tools into our AI SDK tools. [S6, S16, S17]

AI Gateway use is optional at the SDK layer: the durable-agent docs accept provider instances as well as gateway strings. Hosted driver implementation/data shapes create migration cost, but adopting AI SDK does not require all tenants to use Vercel or our loop. [S6]

### Mastra: closest framework alternative; reassess instead of ruling it out

Mastra combines agents, memory/storage, workflows, observability and channel integrations. Its channels wrap Chat SDK, so their presence does not independently solve Chat SDK's ingress/egress guarantees. [S7]

Importantly, **SDK agents preserve the provider SDK's own runtime, tools, permissions and loop**. Documented wrappers include Claude, Cursor and OpenAI Agents SDK, with compatible `generate()`/`stream()` results, resume data and usage/tool spans where the SDK exposes them. Its A2A integration consumes remote agents and exposes local ones. BYO is real here, not merely “choose another model.” [S8]

However, the current A2A docs explicitly state that **task records and push-notification configurations are in memory**, follow-up resumes require the same process, and push delivery is best-effort. Durable agent snapshots do not by themselves make that A2A task store durable. This is a concrete issue for long-running remote support agents across restarts/replicas. [S8]

Durable agents were added in core 1.45.0 and are explicitly **beta, with breaking changes possible without a major bump**. Recovery is off by default; configuration and a suitable storage/PubSub backend are required. Replay can repeat LLM calls and side-effecting tools; memory/run fencing depends on adapter capabilities. These are strong primitives, but not turnkey delivery or human ownership semantics. [S9]

Adopting Mastra trades integration work for its agent/memory/storage/server/stream abstractions and operational model. That may be worthwhile for a greenfield hosted-agent product; it is less compelling for replacing our already working AI SDK driver while still writing the conversation control plane. **Spike it if wrapping third-party SDKs is the dominant customer need.** Review enterprise boundaries before using its auth or agent-editor features; the repo is not uniformly Apache-2.0. [S8, S9, S18]

### Inngest AgentKit: execution useful; network abstraction not our key seam

AgentKit supplies agents, networks, shared state/history, deterministic or model-based routers, MCP tools and agent handoffs. Its support example uses Inngest `waitForEvent()` for human input. With Inngest, execution is durable; nothing in these examples establishes a multichannel operator inbox or a general customer-owned remote-agent driver contract. [S10]

Use **Inngest independently of AgentKit** if its event-driven execution fits our eventual runtime choice. Replacing the hosted loop with networks solely to gain durability is unnecessary. Lock-in is Inngest step/event/replay semantics plus its service or self-hosted execution infrastructure. AgentKit is Apache-2.0, but the server's **SSPL with a three-year future Apache grant** needs separate legal review for a platform exposing service functionality. SDK licensing is not server licensing. Its slower observed package release cadence is a diligence concern, not proof of abandonment. [S10, S18, S19]

### Workflow: leading execution spike, not a whole core

The current durable AI API is **`WorkflowAgent` from `@ai-sdk/workflow`**, replacing `DurableAgent` from `workflow/ai`; current docs require Workflow 5. It provides the AI SDK loop with durable model/tool steps, stream replay and approvals. Tools without `"use step"` remain in-memory functions; adoption requires deliberately locating side effects and serializable state. Do not plan a migration around the deprecated class name or assume a plain `ToolLoopAgent` is durable. [S6]

Worlds separate storage/queue/runtime infrastructure; Vercel is the managed option and a PostgreSQL World is documented for self-hosting. That reduces hosting lock-in, not programming-model lock-in: directives, replay rules, serialized context, stream conversion and pending run migrations still matter. The API has recently changed; pin a compatible package pair and verify recovery rather than treating similar class names as drop-in compatibility. [S6, S11, S19]

Workflow explicitly documents the **external side-effect ambiguity**: an API can succeed while its response is lost, then be called again on retry. Stable step IDs help only where the receiving service can deduplicate. Run-start idempotency is a separate problem; documented hook-based coordination is not an atomic `start()`+domain-record commit. We still need canonical acceptance, durable outbound intent, receipt reconciliation and explicit “unknown” outcomes. Workflow can execute that policy without us building a workflow engine. [S11]

### Other credible candidates

- **LangGraph JS:** orchestration-focused, with graph nodes, persistence, checkpoints, interrupts and streaming. It can wrap existing services without forcing LangChain model calls, but graph/thread/checkpoint semantics become our execution model. LangSmith tracing/deployment is a separate platform choice. Useful when graph/state-edit orchestration is a requirement; no demonstrated advantage over keeping our hosted driver for this channel-control problem. [S12]
- **OpenAI Agents JS:** lightweight loop, tools, sessions, guardrails, tracing, approvals and agent delegation. Custom providers exist; that still is not a general external-agent lifecycle contract. Its “handoff” is delegation between agents, not an operator acquiring the customer conversation. Good as a supported BYO SDK driver (Mastra already demonstrates wrapping it), not a replacement multichannel platform. [S8, S13]
- **Temporal:** credible durable backbone with mature core infrastructure, worker-based execution and replay history. Its AI SDK plugin wraps model calls in Activities, while side-effecting tools must themselves use Activities/Child Workflows. The specific AI SDK/streaming integration is **Public Preview**, even though Temporal itself is established. Prefer it if long-running workflows, self-hosting, operational independence or complex cancellation dominate; worker/service operations are a bigger commitment than a small in-repo boundary. It still needs channel adapters, identity, operator UI and audit policy. [S14, S19]
- **Chatwoot:** the serious whole-product counterexample. It already has web/WhatsApp inboxes, external AgentBot webhooks/API replies, and human takeover by moving conversations from `pending` to `open`, with return to `pending` for the bot. If product #2 is primarily “BYO support bot + omnichannel inbox + human escalation,” adoption can eliminate more work than any agent framework. Costs are its Rails/product/deployment/data model, API translation, and enterprise feature boundaries; verify streaming, A2A, bot cancellation/fencing, audit provenance, tenant isolation and delivery guarantees against actual requirements. Their fit is unverified, not established as absent. [S15, S18]
- **A2A JS SDK:** adopt protocol implementations rather than inventing an agent-to-agent wire format. Agent discovery, task IDs/status, artifacts, follow-up input, cancellation and resubscription provide interoperability; persistence, authentication authorization, version negotiation, identity mapping and provider behavior remain implementation responsibilities. Mastra currently documents v0.3 and v1.0 selection; test the partner's actual version/capabilities, not just an “A2A supported” label. [S8, S16]

## Maturity and licence snapshot

Package versions below are the npm `latest` values observed on the research date, not promises of stability. GitHub release data is used where noted. Active releases establish maintenance activity, not production correctness. Feature-level beta/preview notices outweigh a top-level stable version. Licence summaries are engineering diligence, not legal advice. [S18, S19]

| Candidate | Observed version / maturity signal | Licence and adoption constraint |
| --- | --- | --- |
| Chat SDK | `chat` 4.41.1; repository created Dec 2025; release train active Sept 2026 | MIT; protocol/state shape coupling remains |
| AI SDK | `ai` 7.0.137; existing repo dependency is `^7.0.128` | Apache-2.0; provider/Gateway service terms separate |
| Mastra | `@mastra/core` 1.76.0; broad active framework; durable agents explicitly beta | Apache-2.0 outside **any `ee/` directory**; enterprise auth/editor/builder code has separate terms |
| AgentKit | `@inngest/agent-kit` 0.13.2; latest GitHub release Nov 2025, repo last push Apr 2026 | AgentKit Apache-2.0; Inngest server SSPL, future Apache effective three years after each software availability date |
| Workflow | `workflow` 5.2.0; `@ai-sdk/workflow` 2.0.69; current peer range `workflow: ^5.1.0`; recent durable-agent API migration | Both packages Apache-2.0; backend/service operations and terms separate |
| LangGraph JS | `@langchain/langgraph` 1.4.21 GitHub release, Oct 2026 | MIT for JS framework; LangSmith service/deployment terms separate |
| OpenAI Agents JS | `@openai/agents` 0.20.0; actively released; still 0.x | MIT; OpenAI/provider service terms separate |
| Temporal | Server v1.32.1 latest GitHub release, Oct 2026; repo dates to 2019; AI SDK plugin Public Preview | MIT server; inspect chosen SDK/plugin separately; cloud service terms separate |
| Chatwoot | v4.18.0 GitHub release, Sept 2026; repo dates to 2019 | MIT outside `enterprise/`; enterprise code commercially licensed |
| A2A JS | v1.3.0 GitHub release, Sept 2026 | Apache-2.0; wire-version compatibility still must be checked |

Do not infer repository-wide permission from npm's short `license` field: Mastra's root licence explicitly lists exceptions. Likewise, hosted services are not licensed by their client SDK's licence. [S18]

## Adopt/build boundary

| Layer | Recommendation | What remains ours |
| --- | --- | --- |
| Hosted agent loop, tool/model schemas, web streaming protocol | **Keep AI SDK** inside the hosted driver | Product tools/prompts, limits, permissions and action execution |
| Multichannel normalization, webhook verification, formatting/templates | **Trial/adopt Chat SDK** per channel; do not rewrite proven delivery immediately | Tenant credential routing, ingress acceptance, capability handling and identity policy |
| External SDK/HTTP/A2A agents | **Adopt partner SDKs and A2A JS**; consider Mastra wrappers if they reduce work | Small common lifecycle contract, auth, external session/task mapping, cancellation and capability negotiation |
| Execution, retry scheduling, pause/resume | **Spike Workflow first**; compare Inngest/Temporal against runtime requirements | Domain idempotency, ordering, retry classification, uncertain-send handling, operational recovery |
| Canonical conversations and audit | **Own the model/contract**, backed by existing persistence | Tenant isolation, stable event/action/delivery IDs, provenance, retention/export/deletion and atomicity boundaries |
| Human/operator takeover | **Adopt Chatwoot if product shape fits**; otherwise own a small ownership state machine | Pause/cancel fencing, notification/assignment, same-channel human reply and resume semantics |
| Tracing/evaluation | **Keep OTel + Langfuse**, integrate other driver spans where possible | Canonical trace/session IDs, masking, external-agent visibility limits and audit-to-trace correlation |

These are recommendations derived from the preceding comparison, not an approved architecture. Avoid simultaneous adoption of several orchestration engines. Framework-internal run state and transport caches should remain behind adapters, not become the published domain API.

### Incremental fit with this repository

At the starting revision, `src/lib/ai/assistant.ts` has AI SDK completed/streamed reply entry points plus product-specific Booking Intent/Lead Request extraction and reply provenance. The WhatsApp module already separates inbound jobs, worker execution, outbound deliveries, status processing and confirmation delivery. ADR-0001 mandates a trace per production turn/session per conversation with masking; ADR-0002 retains canonical conversations/transcripts and traces as the plan allows, except explicit deletion requests. These are reasons to preserve working policy and isolate interfaces before swapping execution or transport—not evidence that the present code is already domain-neutral. [S17]

If extraction wins the adoption test: first keep the current implementation as the hosted driver, leave business actions/prompts in Fill the Mat, and route new driver/channel implementations through a small in-repo interface. Poppy can continue independently. Make platform audit persistence the authority and link Langfuse spans to it; **do not introduce trace sampling that violates ADR-0001**, and do not confuse vendor trace retention with ADR-0002's transcript policy. [S1, S17, S20]

## Decision tests before building more

Use the same tests against (A) Chatwoot + a hosted/BYO bot, (B) Chat SDK + current AI SDK + Workflow, and optionally (C) Mastra if SDK wrapping is central. These are proposed experiments, not work authorized by this research ticket.

1. **True BYO:** integrate an existing remote support agent without importing or recreating its prompt/tools/loop; reconnect to an opaque long-running task/session.
2. **Delivery failure cases:** overlapping messages, duplicate webhooks, crash after accepting input, crash after generating a reply, and provider-send success with lost response. Demonstrate recorded ordering, no silent accepted-message loss, and an honest unknown outcome where exact deduplication is impossible.
3. **Takeover race:** operator takes over while an agent is streaming or a remote callback is pending; stale agent sends are blocked, human replies use the same channel, and resume behavior is explicit.
4. **Audit reconstruction:** restart/export and reconstruct inbound events, agent/driver/config provenance where available, tool/action outcomes, ownership changes, outbound attempts and receipts without depending on Langfuse availability. Mark BYO internals unavailable rather than fabricating visibility.
5. **Tenant/channel security:** isolated credentials, signatures/session authorization, permissioned cancellation/resume, safe remote endpoint policy and no accidental cross-tenant identity/history joins.
6. **Incremental/DX:** demonstrate product #2 reusing most of the boundary while Fill the Mat retains domain tools; quantify adapters and operator UI that Chatwoot/Mastra already supply versus what we would maintain.

**Go/no-go:** if A passes with small glue, adopt the product and do not build a generic platform. If B passes with a genuinely small conversation-control layer that product #2 reuses, use rung 1. Failure to achieve simple SDK/DX or incremental extraction is a no-go. Climb to a workspace package only after two real consumers and stable contract/recovery tests; publishing a separate repo remains out of this map's scope. [S1]

## Sources

All external references are primary sources checked on 2026-10-12. Live docs/registry `latest` can change; the snapshot above records what was observed. Licence conclusions use licence text, not GitHub's inferred label alone. This is documentation/source research, not a benchmark or failure-injection validation.

- **S1 — Scope:** [#204 map](https://github.com/fillthemat/fillthemat/issues/204), [#205 question](https://github.com/fillthemat/fillthemat/issues/205), [#208 hosted/BYO decision](https://github.com/fillthemat/fillthemat/issues/208).
- **S2 — Chat SDK channels/approvals:** [official adapter index](https://chat-sdk.dev/docs/platform-adapters), [WhatsApp Cloud](https://chat-sdk.dev/adapters/official/whatsapp), [durable approvals](https://chat-sdk.dev/docs/approvals).
- **S3 — Chat SDK web:** [official web adapter](https://chat-sdk.dev/adapters/official/web).
- **S4 — Chat SDK state/history:** [state adapters](https://chat-sdk.dev/docs/state-adapters), [history, retention, identity and reply persistence](https://chat-sdk.dev/docs/history), [PostgreSQL adapter](https://chat-sdk.dev/adapters/official/postgres).
- **S5 — Chat SDK delivery primitives:** [overlapping messages, defaults and queue limits](https://chat-sdk.dev/docs/concurrency), [error handling](https://chat-sdk.dev/docs/error-handling).
- **S6 — AI SDK:** [building agents](https://ai-sdk.dev/docs/agents/building-agents), [current WorkflowAgent, migration and replay limitations](https://ai-sdk.dev/v7/docs/agents/workflow-agent).
- **S7 — Mastra channels/storage/tracing:** [channels](https://mastra.ai/docs/channels.md), [WhatsApp integration](https://mastra.ai/integrations/channels/whatsapp.md), [observability](https://mastra.ai/docs/observability/overview), [tracing](https://mastra.ai/docs/observability/tracing/overview.md).
- **S8 — Mastra BYO/A2A:** [SDK agents](https://mastra.ai/docs/connections/sdk-agents.md), [A2A versions, in-memory task records and best-effort push](https://mastra.ai/docs/connections/a2a.md).
- **S9 — Mastra durability:** [durable agents: beta, recovery, replay and fencing](https://mastra.ai/docs/harness/durable-agents.md).
- **S10 — AgentKit:** [first-party package README](https://github.com/inngest/agent-kit/blob/main/packages/agent-kit/README.md), [support/HITL example](https://github.com/inngest/agent-kit/tree/main/examples/support-agent-human-in-the-loop), [Inngest steps](https://www.inngest.com/docs/learn/inngest-steps).
- **S11 — Workflow:** [deployment/Worlds](https://workflow-sdk.dev/docs/deploying), [PostgreSQL World](https://workflow-sdk.dev/worlds/postgres), [step and run idempotency](https://workflow-sdk.dev/docs/foundations/idempotency).
- **S12 — LangGraph JS:** [orchestration overview](https://docs.langchain.com/oss/javascript/langgraph/overview), [persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence), [interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts).
- **S13 — OpenAI Agents JS:** [overview](https://openai.github.io/openai-agents-js/), [models](https://openai.github.io/openai-agents-js/guides/models), [handoffs](https://openai.github.io/openai-agents-js/guides/handoffs), [sessions](https://openai.github.io/openai-agents-js/guides/sessions), [HITL](https://openai.github.io/openai-agents-js/guides/human-in-the-loop), [tracing](https://openai.github.io/openai-agents-js/guides/tracing).
- **S14 — Temporal:** [AI SDK integration and Public Preview notice](https://docs.temporal.io/develop/typescript/integrations/ai-sdk), [Activity fundamentals](https://docs.temporal.io/activities).
- **S15 — Chatwoot:** [AgentBots/BYO and human handoff](https://www.chatwoot.com/hc/user-guide/articles/1677497472-how-to-use-agent-bots), [official project/channels](https://github.com/chatwoot/chatwoot), [self-hosting](https://developers.chatwoot.com/self-hosted).
- **S16 — A2A:** [protocol specification](https://a2a-protocol.org/latest/specification/), [official JS SDK](https://github.com/a2aproject/a2a-js).
- **S17 — Existing implementation at research base `f54e1c4`:** [hosted assistant](https://github.com/fillthemat/fillthemat/blob/f54e1c4/src/lib/ai/assistant.ts), [WhatsApp module](https://github.com/fillthemat/fillthemat/tree/f54e1c4/src/lib/whatsapp), [package dependencies](https://github.com/fillthemat/fillthemat/blob/f54e1c4/package.json), [ADR-0001](../adr/0001-trace-every-production-turn.md), [ADR-0002](../adr/0002-keep-all-conversation-data.md).
- **S18 — Licences:** [Chat SDK MIT](https://github.com/vercel/chat/blob/main/LICENSE), [AI SDK Apache](https://github.com/vercel/ai/blob/main/LICENSE), [Mastra root/exceptions](https://github.com/mastra-ai/mastra/blob/main/LICENSE.md), [Mastra enterprise](https://github.com/mastra-ai/mastra/blob/main/ee/LICENSE), [AgentKit Apache](https://github.com/inngest/agent-kit/blob/main/LICENSE.md), [Inngest server SSPL/future Apache](https://github.com/inngest/inngest/blob/main/LICENSE.md), [Workflow Apache](https://github.com/vercel/workflow/blob/main/LICENSE.md), [LangGraph JS MIT](https://github.com/langchain-ai/langgraphjs/blob/main/LICENSE), [OpenAI Agents MIT](https://github.com/openai/openai-agents-js/blob/main/LICENSE), [Temporal server MIT](https://github.com/temporalio/temporal/blob/main/LICENSE), [Chatwoot MIT/enterprise exceptions](https://github.com/chatwoot/chatwoot/blob/develop/LICENSE), [A2A JS Apache](https://github.com/a2aproject/a2a-js/blob/main/LICENSE).
- **S19 — Version/cadence evidence:** npm metadata for [ai](https://registry.npmjs.org/ai/latest), [chat](https://registry.npmjs.org/chat/latest), [Mastra core](https://registry.npmjs.org/@mastra/core/latest), [AgentKit](https://registry.npmjs.org/@inngest/agent-kit/latest), [Workflow](https://registry.npmjs.org/workflow/latest), [AI SDK Workflow](https://registry.npmjs.org/@ai-sdk/workflow/latest), [OpenAI Agents](https://registry.npmjs.org/@openai/agents/latest); first-party GitHub [Chat SDK repository metadata](https://api.github.com/repos/vercel/chat), [AgentKit metadata](https://api.github.com/repos/inngest/agent-kit), [AgentKit releases](https://github.com/inngest/agent-kit/releases), [LangGraph release](https://github.com/langchain-ai/langgraphjs/releases/tag/%40langchain/langgraph%401.4.21), [Temporal release](https://github.com/temporalio/temporal/releases/tag/v1.32.1), [Chatwoot release](https://github.com/chatwoot/chatwoot/releases/tag/v4.18.0), [A2A JS release](https://github.com/a2aproject/a2a-js/releases/tag/v1.3.0).
- **S20 — Langfuse:** [observability overview](https://langfuse.com/docs/observability/overview.md). The canonical audit versus observability boundary is our recommendation; the source documents trace capabilities, not our product's audit guarantee.
