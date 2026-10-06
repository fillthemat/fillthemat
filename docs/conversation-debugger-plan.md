# Conversation debugger — implementation handoff

Status: **planned; not implemented**.

## Goal

An operator runs a preview conversation, follows a link to its timeline, expands any turn to inspect each model call and tool execution, annotates a bad turn, and compares it with the next recovery turn. The motivating case is: the assistant promises to check slots, stops, and only performs the lookup after another user message.

We are observing execution, not exposing or reconstructing private chain-of-thought. Inputs, outputs, tools, timing, and termination evidence are the debugging surface. A technically successful turn can still be a behavioral failure.

## Decisions and scope

- Use **Langfuse Cloud** for the initial conversation/session view, trace timeline, annotations, and dataset handoff. Do not build a custom timeline UI or self-host another stack in this release.
- Keep Supabase as the canonical transcript/application database, Vercel as the execution host, and Vercel AI Gateway as the model gateway. Langfuse is an optional observability dependency, never required to answer a chat.
- First release: explicitly opted-in, authenticated, allowlisted operator **web preview tests using synthetic data**. No general production content capture and no WhatsApp rollout.
- One Langfuse session per conversation; one trace per request attempt; one generation per model invocation; one tool observation per execution. An accepted request attempt corresponds to one assistant turn. Rejected/duplicate attempts must not look like extra generated replies.
- No application schema migration is required for the MVP. Correlate using existing conversation/message IDs plus trace/request IDs in metadata and structured logs. Do not add a telemetry warehouse to Postgres.
- Do not change the prompt, model, scheduling logic, eight-step limit, or booking behavior to fix the motivating incident in this work. First make the execution inspectable.
- No full eval platform, automatic LLM judge, autonomous retries, historical backfill, session replay, or remote prompt-management migration.

## Read before implementation

1. `AGENTS.md`, `skills-lock.json`, `docs/local-development.md`, and `docs/known-gaps.md`.
2. Restore missing locked skills. Load AI SDK, Supabase, and React skills; load browser skills when doing browser QA. Load Postgres guidance if proposing any database changes, which are not expected here.
3. Inspect `git status` and preserve other work. At plan creation, `docs/README.md`, `docs/prod-account-cutover.md`, and `src/components/booking-chat.tsx` already had unrelated edits. Reinspect rather than assuming this snapshot remains current.
4. Read installed, version-matched docs before writing code:
   - `node_modules/ai/docs/03-ai-sdk-core/60-telemetry.mdx`
   - AI SDK agent, streaming, lifecycle, and React transport documentation/source relevant to the chosen integration.
   - `node_modules/next/dist/docs/01-app/02-guides/instrumentation.md`
   - `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md`
   - `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`
5. Fetch current Langfuse docs and follow relevant SDK links:
   - https://langfuse.com/integrations/frameworks/vercel-ai-sdk.md
   - https://langfuse.com/docs/observability/best-practices.md
   - https://langfuse.com/docs/observability/features/sessions
   - SDK instrumentation, masking, batching/flushing, trace URLs, retention, comments/scores, and datasets.

### Version/runtime trap

This checkout uses AI SDK 7, Next.js 16, and Bun 1.4. Installed AI SDK docs use `telemetry`, `onStepEnd`, and `onEnd`; older examples use deprecated names. Telemetry becomes enabled by default after global registration, and inputs/outputs are recorded by default unless explicitly disabled.

The current Langfuse integration guide has a dedicated SDK 7 path using `@langfuse/vercel-ai-sdk` with `LangfuseVercelAiSdkIntegration`; it declares Node.js 22+ support. Its later Next.js streaming example is labeled **v6**. Do not copy that example blindly or assume Node-only support implies Bun compatibility. Prove the SDK 7 integration works on this project's actual local and Vercel runtime before building the UI. Do not silently change the application runtime or install multiple competing global OpenTelemetry providers.

## Existing integration points

| File | Responsibility / change seam |
| --- | --- |
| `src/app/api/chat/route.ts` | Access check, resume-token lookup, conversation lock, canonical history, stream, assistant persistence |
| `src/lib/ai/booking-agent.ts` | Model/Gateway configuration, `ToolLoopAgent`, four tools, eight-step cap |
| `src/lib/ai/system-prompt.ts` | Platform prompt plus school settings and FAQs |
| `src/lib/ai/run-agent.ts` | Non-streaming runner used by WhatsApp; must stay untraced by default |
| `src/components/booking-chat.tsx` | Chat transport, transcript rendering, client status; debug controls belong here or in a small extracted component |
| `src/components/browser-token.ts` | Current per-school browser resume-token storage |
| `src/app/s/[slug]/page.tsx` | Landing/preview page; derive debug capability server-side |
| `src/lib/schools/public.ts` | School access and catalog loading |
| `src/db/schema.ts` | Existing conversation/message identities; no change expected |
| `vercel.ts` | Hosted runtime/build configuration; avoid unrelated changes |

Important facts:

- `preview=1` is a product flag, not a Vercel deployment environment or an authorization grant. Published schools can be accessed without an owner login even when this flag is set.
- Web conversations currently have nullable, unpopulated landing-session/contact links; do not use those to authorize debugging.
- Canonical message `parts` contain tool activity but not a complete historical execution trace.
- The route drains SSE using `consumeSseStream` and saves the assistant via stream `onEnd`. Preserve those behaviors.
- A return of the streaming `Response` is not the end of the turn.
- There are in-progress transcript hydration edits. Coordinate rather than reverting them or independently implementing a competing fix.

## Required trace contract

Use stable observation names, IDs, and a documented metadata version. Exact attribute spelling may follow the supported Langfuse integration; the semantics below are mandatory.

### Identity and scope

- `sessionId`: existing server-resolved `conversation_id`; separate Langfuse projects for local/test versus hosted where practical.
- `traceId`: valid generated trace identity for this request attempt; never derive it from the bearer resume token.
- `requestId`: server-generated request ID, included in safe structured Vercel logs and response metadata.
- `userMessageId`, `assistantMessageId` when available: link the execution to `app.messages.message_id` within the conversation.
- `schoolId`, `channel=web`, `debugCapture=true`, actual deployment environment, deployment/commit identifier, and `captureSchemaVersion`.
- Keep product preview status separate from `VERCEL_ENV`. Do not call an owner preview on production a Vercel Preview deployment.
- Include Gateway/provider generation IDs only where the installed SDK actually exposes them. Missing is acceptable; never invent IDs or claim a guaranteed Gateway deep link.

### Trace hierarchy

```text
Langfuse session: conversation_id
  booking-chat.turn (one request attempt)
    context.load (catalog/history timing; no full DB dumps)
    booking-agent
      model step 1 (generation)
      list_trial_offerings (tool, linked by toolCallId/step index)
      model step 2 (generation)
      list_trial_slots (tool, if actually invoked)
      model step 3 (generation)
    transcript.persist
    turn completion / stream outcome
```

Do not duplicate generations/tools if the SDK integration already creates them. Do not count aggregate agent usage and child usage twice. Root input/output should contain only this turn's user text and assistant response so Langfuse's session view can form a readable conversation without repeating the full history. Each generation contains the effective context for that invocation under the capture policy.

### Evidence to capture

- Model identifier and effective generation settings; deployment commit and explicit platform-prompt version/hash.
- Effective system instructions, model-visible history, and available tool definitions for opted-in synthetic tests. Verify later steps include preceding tool results, not just the original user message.
- School/FAQ configuration identity or hash as well as the captured effective prompt. A Git SHA alone does not version mutable school settings.
- Tool name, call ID, validated arguments, result or sanitized error, start/end timestamps, and duration.
- Per-model-call output, raw finish reason where exposed, usage, duration, and time-to-first-output where measurable. Name application and provider latency metrics accurately.
- Step count and explicit termination evidence: natural completion, enforced step limit, model/tool failure, or unknown. Do not infer a step-limit termination merely because there were eight steps; record whether the stop predicate actually triggered.
- Separate generation outcome, stream outcome, and transcript persistence outcome. Model success followed by DB failure is not an end-to-end success.
- Root end-to-end duration includes transcript persistence. Record missing/unavailable fields as such, not zero or fabricated success.
- Explicitly exclude private reasoning/chain-of-thought fields, secrets, authorization/cookie headers, raw request objects, resume tokens/hashes, and arbitrary provider metadata.

Technical success must remain separate from an operator annotation such as `promised_lookup_without_action`. Do not implement a string-matching heuristic as authoritative evidence that the model stalled.

## Privacy and authorization contract

1. Server tracing switch defaults **off**. Missing configuration degrades to normal chat without telemetry.
2. Detail capture requires all of: enabled server configuration, authenticated owner of the requested school, membership in a server-side operator-ID allowlist, explicit debug opt-in, and a fresh debug-only conversation.
3. Apply that check on every request. A client boolean, localStorage key, query parameter, published-school access, or browser bearer token is insufficient authorization for detail capture or trace-link disclosure.
4. Use a separate browser token namespace for debug tests so enabling capture cannot export earlier real-user history. On entering debug mode, start fresh. Reset clears/remounts the debug client state but does not delete earlier transcripts or traces. Ensure the server verifies the debug conversation boundary, not merely trusting the client namespace: use a signed, expiring debug-context token bound to owner, school, and the new resume-token hash, or an equivalently verified server-side mechanism. Never export this context token.
5. The debug UI must warn: synthetic data only; prompts, messages, and tool results are sent to Langfuse. Mask obvious email/phone/contact fields and cap payload sizes before export; regex masking alone is not a production PII guarantee. Mark masked/truncated captures so operators know they are not exact replays.
6. Implement exporter-level allowlisting/masking so automatic exception attributes, nested tool payloads, provider metadata, and other SDK defaults cannot bypass the policy. Test actual exported payloads, not only helper outputs.
7. Disable telemetry explicitly for all non-debug agent invocations, including the shared WhatsApp path. Avoid registering broad HTTP/DB auto-instrumentation that exports unrelated data.
8. All Langfuse credentials remain server-only, including its so-called public API key. Never use `NEXT_PUBLIC_` for credentials. Trace links require Langfuse project login; do not enable public sharing.
9. Human operator chooses region and restricted project membership. Target seven-day test-trace retention; verify the account supports automatic deletion or document and verify an alternative deletion process before enabling capture. Supabase's transcript cleanup does not delete Langfuse data.
10. Langfuse annotations and dataset entries have their own lifecycle. Use sanitized synthetic fixtures for lasting regression cases; do not make sensitive trace exports permanent test artifacts.

## Implementation phases

### Phase 1 — compatibility spike and optional tracing foundation

- Add minimal, compatible, pinned dependencies and commit the Bun lockfile. Prefer the documented SDK 7 Langfuse integration over generic legacy snippets; do not add an unused model-provider package or change AI Gateway.
- Add `src/instrumentation.ts` and a server-only module under `src/lib/observability/` for initialization, configuration, masking, trace context, and bounded flushing. Adapt exact files to verified APIs.
- Keep one tracer provider per runtime and avoid duplicate registration on hot reload. Never keep a current request/conversation ID in mutable global state.
- Use a no-op implementation when disabled or unconfigured. An exporter/network failure must not break chat or persistence.
- Prove a deterministic two-step tool loop yields distinct generation/tool observations under one root and retains async context during streaming. Prove a concurrent second conversation cannot inherit the first conversation's metadata.
- Verify actual Bun/Vercel compatibility. If unsupported, stop with a documented blocker or demonstrate a minimal supported adapter without changing application runtime; do not disguise an unverified integration as done.

Exit: captured test spans demonstrate correct hierarchy and safe disabled behavior before UI work.

### Phase 2 — request/agent instrumentation and lifecycle

- Add the debug gate/context verification and identities in `/api/chat`; pass an explicit tracing context to `createBookingAgent`. Non-debug callers default to tracing disabled.
- Capture accepted turns plus authorized rejected attempts (duplicate, expired, generation-in-progress, limits) with distinguishable outcomes. Never duplicate a canonical message for tracing.
- Integrate effective prompt/settings versions, model generations, tools, and actual stop-predicate evidence. Use SDK lifecycle hooks only where automatic integration lacks required fields.
- Keep the root observation alive through asynchronous streaming and assistant persistence; use one idempotent finalizer across completion/error/abort paths. Close spans and preserve/release conversation locks according to existing semantics, independently of exporter success.
- Audit pre-stream exceptions, async stream errors, DB persistence failures, and early returns. Do not assume the existing route's outer `catch` catches all streaming failures. If unrelated lock bugs are uncovered, document a focused correction with tests rather than silently expanding into a lock-recovery redesign.
- Distinguish browser disconnection from actual generation abortion: existing SSE draining can allow the backend to finish after the client leaves. Do not mark every disconnect aborted.
- Register bounded flushing with the supported Next.js/Vercel lifecycle (`after` or verified equivalent), ensuring it runs after final spans are ended. Do not fire-and-forget export or shut down the shared provider per request. Verify live streaming is not buffered waiting for export.
- Log safe `turn_started` and `turn_finished`/failure records with correlation IDs to Vercel, even if Langfuse export fails. Log export failures without payloads/secrets.
- Abrupt process termination cannot guarantee a final span or flush. Document how to identify incomplete traces using request-start logs, missing completion, and Supabase `generating_at`; never label missing evidence as success or a proven timeout.

Exit: the full turn is inspectable, including failures, without changing booking behavior.

### Phase 3 — operator preview entry point

- Server-derived, allowlisted preview controls: **Start debug conversation**, **New test**, **Open conversation timeline**, and optionally **Open latest turn**.
- Obtain verified debug context through a small owner-authorized server action or endpoint; check origin/CSRF protections appropriate to the chosen mechanism. No generic arbitrary-trace lookup endpoint.
- Deliver server-generated correlation IDs/links using supported response headers or typed UI stream metadata. For refresh, authorized GET history can rederive the conversation session link without storing a new telemetry table. Never include trace credentials or raw tokens in URLs/logs.
- Construct links only from configured trusted Langfuse origins/project IDs and verified SDK URL formats. Fail safely if the link configuration is absent.
- Fresh test creation rotates only debug tokens, resets prepared-booking/client message state, and does not lose the previous Langfuse timeline. Prevent late hydration/stream callbacks from contaminating the new test; disable reset/send appropriately while a turn is active.
- Retain the current message on errors where practical and display sanitized failures/request IDs rather than silent stalling. Do not automatically retry accepted user messages or reopen booking actions during hydration.
- Use existing design patterns; no new admin dashboard or public debugging controls.

Exit: an operator can perform a multi-turn test, refresh, and open that same session; New test creates a distinct session.

### Phase 4 — annotations and regression handoff

- In Langfuse, document adding a turn comment/score, e.g. `behavior_issue=promised_lookup_without_action`, with the observed symptom and expected action. Confirm the selected plan supports the required workflow; use a simple trace comment if advanced annotation queues are unavailable.
- Demonstrate comparing the failed turn with the next recovery turn in the same session. Technical outcome and human quality score remain separate.
- Add a sanitized synthetic Tuesday/age-five fixture and explicit behavioral assertions: eligible offering lookup, actual slot lookup before claiming availability, Tuesday filtering in the answer or an honest no-match response, no invented slot, and no claim that a booking was created.
- Add deterministic instrumentation regression tests using a scripted model that deliberately promises research without calling a tool and then performs the tool call on the next turn. This proves the debugger exposes the failure; it does not prove the real model behaves correctly.
- Provide a documented manual path from the marked trace to a sanitized dataset case. Live-model eval automation is a follow-up, opt-in, budgeted workstream, not a required network call in ordinary CI.

Exit: the motivating failure has an inspectable example and a reusable evaluation specification.

### Phase 5 — documentation, hosted smoke, and rollout

- Add an operator runbook with screenshots or precise navigation: start fresh test, open session, inspect step context/tools/finish reason, annotate, compare recovery, locate Supabase rows and Vercel/Gateway logs by IDs/time.
- Document server env switches, operator UUID allowlist, Langfuse URL/project/credentials, disabled behavior, data handling/retention, deployment distinctions, troubleshooting, and rollback. Confirm credential variable names against the installed SDK. Update `docs/local-development.md` only for the optional integration; preserve its bootstrap/port contract.
- Update `docs/known-gaps.md` accurately: test tracing does not equal production-wide privacy-safe analytics, and it does not solve historical capture or all stale-lock scenarios.
- Provisioning Langfuse, selecting region/plan/retention, installing secrets, and deploying require explicit operator approval. Never put secrets in the handoff, repo, screenshots, or test output.
- After approval, perform a real hosted smoke with synthetic data. Verify session links, streamed tokens, per-step spans, persistence timing, and flush delivery on the actual Vercel runtime.
- Rollback: turn off capture; chat continues unchanged. This stops new export, not deletion of existing Langfuse data. Verify deletion separately.

## Test matrix / acceptance criteria

Use injectable tracing/export seams and scripted model responses; ordinary CI must not depend on Langfuse Cloud or paid model calls.

| Scenario | Required evidence |
| --- | --- |
| Three-turn happy path | One session, three accepted-turn traces, canonical message IDs, correctly ordered generations and tools |
| Promises lookup but stops | Technically completed trace with no `list_trial_slots` invocation; annotation remains separate |
| User prompts recovery | New turn in the same session; actual slot tool input/output visible |
| Tool error / invalid arguments | Failed tool or validation evidence with safe error and terminal outcome, not silent success |
| Model error after text begins | Partial output plus failed stream/generation outcome; UI reports failure |
| Step cap | Recorded stop-predicate decision and step count, not an inferred finish reason |
| Persistence failure | Generation success distinct from failed transcript persistence; trace closes and logs correlate |
| Duplicate / lock contention / expiry | Rejected attempt identifiable; no extra assistant message or model call |
| Browser disconnect | Accurate backend completion versus actual abort; existing SSE drain behavior preserved |
| Exporter unavailable / missing keys | Normal chat/persistence still work; bounded safe diagnostics; no hung request |
| Missing terminal event / simulated hard kill | Incomplete/unknown diagnosis and documented log correlation; no guarantee of final delivery |
| Public user adds preview/debug flags | No content export or private trace links; no debug-context issuance |
| Wrong school / expired debug context | Authorization rejected; no transcript leakage |
| Non-debug web and WhatsApp | No automatic model/tool content export after global instrumentation registration |
| Two simultaneous conversations | No mixed session IDs, messages, spans, or request context |
| Sensitive payload in nested tool/error/provider fields | Export inspection shows masking/exclusion, including secrets and reasoning fields |
| Debug enabled after prior ordinary chat | Fresh verified context; earlier transcript is not exported |
| Refresh and new test | Existing session link recoverable; new test isolated; no hydration races or stale booking state |
| Capture disabled | No functional change to public preview/chat/bookings and no added vendor requirement |

Commands after implementation:

```bash
bun run lint
bun run check
bunx tsc --noEmit
bun run test
bun run test:integration
bun run test:e2e
bun run build
```

Run local-stack/browser checks according to `docs/local-development.md` and the worktree contract. Report environmental/pre-existing failures separately; do not claim unrun checks passed. Browser automation must use the applicable installed skills. Keep proof artifacts free of secrets and real participant data.

## Completion handoff

The implementing agent should return:

1. Changed files and the trace contract actually implemented.
2. Verified dependency/runtime compatibility and any deviation from this plan.
3. Test results, plus explicitly unrun checks or hosted blockers.
4. A synthetic session link showing a stalled turn and its recovery, or a clearly labeled local exported-span fixture if hosted access is unavailable.
5. Exact operator steps for provisioning, enablement, inspection, retention/deletion, and rollback.
6. Remaining gaps, especially hard-kill delivery, production capture, and automated real-model evals.

**Definition of done:** after a few preview exchanges, the operator can open one authenticated session timeline, identify which model calls and tools did or did not run in a chosen turn, inspect why execution ended where evidence exists, annotate the problem, and compare the recovery turn—without searching raw database JSON or exposing unrelated conversations.
