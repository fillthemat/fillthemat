# Assistant regression eval (#97 / spec #92)

The fixed dataset is **`assistant/spec-92-v1`**, Langfuse ID
`cmv1sgos605i4ad0ketqpen68` (project `cmuvyfd3403hqad0cggv1s062`).
`scripts/assistant-eval/cases.ts` is the reviewable source of truth. No database,
running app, Supabase writes, bookings, leads, or outbound messages are involved.

## Cases and provenance

Twelve cases use the observed Kids Beginner Trial (ages 4–10, Mondays at 18:00,
45 minutes), parking fact, and booking conversation from production trace
`2984ebfa5fdefdd837e9d791b9e798dd`, observation `b29814d8871c4a08`.
The source was inspected with `langfuse-cli api observations list` (October 1–10,
2026, `core,basic,io,metadata,trace_context`). This project's available traffic
was one short conversation, **not twelve independent production conversations**.

| Reconstructed turns | Requirement variants (explicitly labeled) |
| --- | --- |
| Son/daughter age qualification; age 5; recap; choosing an occurrence without a name; happy booking continuation | Age 15 rejection; no open occurrences; malicious owner instructions; approved FAQ; explicit contact request; unpublished price/discount |

Each item stores the full turn input (school, catalog, fixed clock, UI history),
expected required/forbidden tool calls, Booking Intent and Lead Request (or null),
and semantic `must` / `mustNot` reply rules. Metadata stores case ID, source IDs,
and how the trace was reconstructed or varied. IDs and school identity are
anonymized; the participant is Sam. Availability and `now` never depend on today's
date. Existing old tool names in reconstructed history deliberately remain intact.

Email/phone masking is the **same function used by production trace export**
(`maskContactFields` in `src/lib/tracing/span-processor.ts`, ADR-0001). It also
handles JSON-encoded trace inputs. Dataset writes, judge inputs, reports and
trace spans are masked; ages, dates and times are preserved. Credentials are
loaded only through ignored env files, never printed or placed in a dataset.

**Review the draft expected outputs in Langfuse before using this as a release
gate.** These are requirement-based labels, not human-annotated production gold
answers. Review failing judge comments and calibrate the rubric with a human;
model judgments are not guaranteed ground truth.

## Seed and run

Run from the checkout containing this runner. Load production Langfuse keys and
Gateway credentials explicitly; substitute your own env-file paths. On this
machine those files live at the main repository root, not a child worktree.
No `bun run setup` or app server is needed for this isolated runner.

```bash
# One-time creation/upsert of the fixed dataset (no model calls).
bun --no-env-file --env-file=/path/to/main/.env.production.local \
  scripts/assistant-eval.ts seed

# One command runs the current assistant AND its LLM judge and records an experiment.
bun --no-env-file --env-file=/path/to/main/.env.production.local \
  --env-file=/path/to/main/.env.local scripts/assistant-eval.ts run \
  --model google/gemini-2.5-flash --judge-model google/gemini-2.5-flash \
  --name spec-92-baseline --out /path/to/private/baseline.json
```

With env already exported, the shorter equivalent is
`bun run eval:assistant run --model google/gemini-2.5-flash --name baseline --out /path/to/private/baseline.json`.
The model ID above matches the inspected production traces and was verified
against the Gateway model catalog. Always use exactly the same model for both
variants; the runner never falls back to the scripted local model.

Gateway calls (including judge calls) are paced at **15 seconds/request** by
default to respect the observed team quota of five requests/minute. Use
`--interval-ms 20000` for headroom, or a longer interval if another session shares
the quota. A full run takes several minutes: do not use a short shell timeout.
When OIDC expires, refresh it with the existing `bunx vercel env pull` workflow
in the main checkout; preserve local-development env values per
`docs/local-development.md`. Never paste the token into a command or chat.

## Compare old vs new

Use `--assistant` to load **any checkout's `completedReply` export**. The runner
observes calls through AI SDK model middleware; it does not inspect tool modules
or duplicate the assistant's result-to-intent conversion. This survives #93's
tool extraction. Both assistant and judge temperatures are fixed at zero.

```bash
# Use the same env-file flags as above for each run.
bun run eval:assistant run --model google/gemini-2.5-flash \
  --name old --assistant /path/to/old/src/lib/ai/assistant.ts \
  --out /path/to/private/old.json
bun run eval:assistant run --model google/gemini-2.5-flash \
  --name new --assistant /path/to/new/src/lib/ai/assistant.ts \
  --out /path/to/private/new.json
bun run eval:assistant compare \
  --baseline /path/to/private/old.json --candidate /path/to/private/new.json
```

Reports record run/experiment IDs, dataset-run URL, code commits, per-case scores,
masked replies, provenance hashes and actual tool names. Keep reports private and
outside Git. Langfuse's experiment comparison UI also shows each item and score.
`compare` exits **1** for any lowered or missing per-case score and **0** for no
regressions. It rejects different model IDs, judge models, judge rubric hashes,
or dataset hashes. Missing cases/metrics cannot be averaged away. Renames
`list_trial_slots` → `list_trial_occurrences` and `capture_lead` → `request_contact`
are treated as equivalent only for the call score; raw calls remain visible.

Booking fields are compared exactly, including participant and occurrence.
Lead fields are exact except `statedNeed: "non-empty"`, which requires a nonblank
need but permits paraphrasing. Review the actual need in the masked output;
the judge checks the final reply's stated facts rather than judging intent fields.

## Judge and failures

`scripts/assistant-eval/judge.ts` is a versioned **Langfuse SDK experiment
evaluator**, implemented as an LLM-as-judge through Vercel AI Gateway. Its binary
`reply-rules` score and explanation are recorded in Langfuse alongside the
deterministic tool/intent scores. It is not a hosted auto-evaluation rule and
does not require storing the short-lived Vercel OIDC token in a Langfuse LLM
connection. Judge calls have a separate `judge-assistant-reply` evaluator trace
with case/run metadata; their scores attach to the experiment case. No substring
matching or second model judgment is used for tool calls or intents.

The run refuses changed/missing hosted cases rather than silently seeding or
changing expectations. To change cases, create a new versioned dataset name and
review its labels; don't overwrite a release baseline. SDK task/evaluator errors
produce an incomplete report and a nonzero exit, never a passing baseline.
Comparison needs the saved report from each run; it is offline and makes no
model/API calls. A passing no-regression gate does not imply all baseline cases
passed, so also inspect existing baseline failures.

## Offline tests

```bash
bun run test scripts/assistant-eval
bun run lint
```

Tests exercise actual `completedReply` with a scripted AI SDK model plus the
public scoring/comparison seams, without credentials or network.
