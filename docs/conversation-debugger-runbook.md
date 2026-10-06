# Conversation debugger (opt-in synthetic preview)

**Default: off.** This is not production analytics. Do not enable for real participant data. It does not change the agent prompt, model, scheduling, booking or WhatsApp. Supabase remains the transcript source of truth; Langfuse contains only separately captured debug tests.

## Before enabling (operator-owned)

1. Obtain approval for a Langfuse Cloud project and choose its data region. Restrict membership to operators who need access; do not enable public trace sharing. Use a distinct project for local tests and hosted tests.
2. Set up **seven-day trace deletion** in the chosen Langfuse plan. If the plan cannot automatically delete after seven days, establish and verify a scheduled API/project-deletion process **before** enabling capture. Delete annotations/dataset entries separately; Supabase transcript cleanup does not delete Langfuse data. Verify deletion in the project UI. Synthetic sanitized dataset fixtures may be retained intentionally.
3. Configure server-only variables (never `NEXT_PUBLIC_`):
   - `CHAT_DEBUG_CAPTURE_ENABLED=1` (omit or `0` to keep off)
   - `CHAT_DEBUG_CONTEXT_SECRET` (random 32+ byte secret, stable across instances; rotate to invalidate debug sessions)
   - `CHAT_DEBUG_OPERATOR_IDS` (comma-separated Supabase Auth user UUIDs, not emails)
   - `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` (both are server-only)
   - `LANGFUSE_BASE_URL` (exact trusted Cloud origin, e.g. `https://us.cloud.langfuse.com`; supported: EU, US, JP and HIPAA Cloud)
   - `LANGFUSE_PROJECT_ID` (project ID from the authenticated Langfuse project URL)
   - Real AI Gateway credentials as required by `docs/local-development.md`. Stub mode cannot run a traced model test.
4. Authenticate as an allowlisted school owner. On `/s/<slug>?preview=1`, confirm the synthetic-data warning and click **Start debug conversation**. The server issues a signed 24-hour context bound to the fresh debug resume token and owner/school. A normal conversation cannot be upgraded to debug; tokens use separate namespaces. Every debug POST and GET rechecks owner/allowlist and the signed context. Debug bearer/context tokens never belong in URLs, logs or screenshots.
5. Send several **synthetic** messages. Click **Open conversation timeline** to open `/project/<projectId>/sessions/<conversationId>` in the authenticated Langfuse project. Inspect each `booking-chat.turn` trace: the `booking-agent` model calls (`chat`), `execute_tool` observations and tool-call IDs. The second model call should include the previous tool result. Compare step finish reasons, model timings, step count and `stepLimitTriggered`; an eight-step turn alone does not prove a limit termination. Root metadata separately records stream and persistence outcomes. Lack of a terminal span is **unknown**, not success.
6. In Langfuse, select the stalled-turn trace and leave a comment or score with `behavior_issue=promised_lookup_without_action`, the observed symptom and the expected slot lookup. Select the following turn under the same session to compare actual tool execution. If the plan lacks annotation queues, use a trace comment. To hand off a regression, copy only sanitized synthetic inputs and expected tool assertions into a dataset item; never promote raw real-user traces to lasting fixtures. See `docs/fixtures/tuesday-age-five-debug.json`.
7. **New test** creates a different conversation/session and clears the previous test's local chat and booking preparation state, but does not delete previous traces. Refresh preserves the current tab's debug session for up to 24 hours. Open the old timeline before rotating if you need its link.

## Verification and correlation

Run `bun scripts/conversation-debugger-spike.ts` without keys for an in-memory, synthetic example: one stalled trace with no slot tool followed by a recovery trace with `list_trial_slots`, both under `synthetic-tuesday-age-five`. The script also checks concurrency, multiple model steps, streaming and opt-out. `docs/fixtures/tuesday-age-five-local-spans.json` is a captured **local exported-span fixture** (not a Cloud link); regenerate with `bun scripts/conversation-debugger-spike.ts --fixture docs/fixtures/tuesday-age-five-local-spans.json`. This is **not** a hosted trace or Cloud proof. Check the delegate and actual local OTLP HTTP request-body masking tests via `bun run test -- src/lib/observability/safe-exporter.test.ts` (the HTTP receiver is in-process; no Cloud or real credentials).

In a hosted smoke, verify streamed tokens are visible before export completes; model calls and tools have one shared trace ID; the root ends after transcript persistence; a refresh retains the session URL; **New test** changes it; a published school's public visitor with `preview=1` sees no controls and exports nothing; non-debug web and WhatsApp emit no model spans. Check Supabase `app.conversations` by conversation ID and `app.messages` by the user/assistant message IDs from trace metadata. Search Vercel logs for `requestId` (`turn_started`, `turn_trace_started`, `turn_finished`, `turn_rejected`, `turn_rejected_trace`, `turn_outcome_unknown`, `chat_debug_export_failed`), then Gateway logs by time/model/school; Gateway generation IDs are not assumed. `VERCEL_ENV` is separate from the product `preview=1` flag. Abrupt process death may leave only the start log and `generating_at`; no final span or flush is guaranteed.

The exporter strips non-allowlisted attributes, SDK events, status messages, resource attributes, reasoning parts and obvious email/phone/contact/secret fields, and caps content. Masked/truncated captures are **not exact replays**, and regex masking is not a guarantee of PII removal. Do not use this for general production content. Missing fields are unavailable, not zero. Cloud export and its seven-day retention **must** be verified before rollout.

## Rollback

Set `CHAT_DEBUG_CAPTURE_ENABLED=0` (or remove it) and redeploy. Existing public chat and booking continue; this only stops **new** exports. Revoke Langfuse keys if needed and delete old Langfuse traces/annotations according to the verified retention procedure. Do not confuse disabling capture with deleting previously exported data.

## Known limitations

No hosted smoke or retention proof exists until an operator provisions a project and approves deployment. The browser uses per-tab session storage; after 24 hours create a new test. A hard kill cannot reliably flush. The disabled fallback remains the existing local chat stub. Manual annotations are separate from technical outcomes; there is no live-model eval, automatic judge, production capture or historical backfill.
