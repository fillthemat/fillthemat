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

Email/phone masking reuses **production's decoded-field masking**
(`maskContactFields` in `src/lib/tracing/span-processor.ts`, ADR-0001). The eval-only
`maskEvalFields` wrapper in `scripts/assistant-eval/masking.ts` also decodes nested
JSON-encoded trace inputs; production preserves its original text-masking behaviour.
Dataset writes, judge inputs, reports and
trace spans are masked; ages, dates and times are preserved. Credentials are
loaded only through ignored env files, never printed or placed in a dataset.

**Review the draft expected outputs in Langfuse before using this as a release
gate.** These are requirement-based labels, not human-annotated production gold
answers. Review failing judge comments and calibrate the rubric with a human;
model judgments are not guaranteed ground truth.

## Recorded baseline

The completed old-assistant baseline (commit `e76e0cc`, October 9, 2026) is
**`spec-92-baseline-e76e0cc-paced-20261009`**, experiment ID
`1cdaf02e-bb96-4d19-b337-46cdf7bb5fe6`.
[View the experiment in Langfuse](https://us.cloud.langfuse.com/project/cmuvyfd3403hqad0cggv1s062/datasets/cmv1sgos605i4ad0ketqpen68/runs/1cdaf02e-bb96-4d19-b337-46cdf7bb5fe6).
Both assistant and judge used `google/gemini-2.5-flash`, paced at 20 seconds/request.
All 12 cases completed and every deterministic tool/intent check passed. The
draft reply judge failed three cases:

- `explicit-contact`: promised school contact before platform consent.
- `no-open-occurrences`: offered no alternative next step.
- `chosen-occurrence-missing-name`: did not ask for the participant's name.

Self-comparison of the saved report exits 0. This is a complete baseline with
existing failures, not an all-passing release gate. It predates the separate
judge evaluator tracing described below. The private local report is
`spec-92-baseline.json` in the session's OpenCode temporary directory;
preserve it outside Git for later comparisons (temporary storage is not archival).

## Every-turn prompt gate (#98)

The baseline **`spec-92-baseline-e76e0cc-paced-20261009`** compared with
**`issue-98-every-turn-prompt-v2`**, experiment
`acc3ea5e-3861-430d-b246-1bf638f5584e`, using the same assistant and judge model
`google/gemini-2.5-flash`: **compare exit 0, zero regressions**.
`explicit-contact` and `chosen-occurrence-missing-name` failed their reply rules
in both runs; both failures pre-exist in the baseline.

## Seed and run

Run from the checkout containing this runner. Load production Langfuse keys and
Gateway credentials explicitly; substitute your own env-file paths. Use the main
repository root's env files, not a child worktree's local-stack credentials.
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

## Tool-name replay check (#99)

`scripts/assistant-replay-check.ts` sends a JSON-round-tripped saved web-chat
history containing **both** `tool-list_trial_slots` and `tool-capture_lead` to
the real Gateway `google/gemini-2.5-flash` model. It exercises `completedReply`
and the actual web-chat `streamedReply` path, checks a completed nonempty reply,
and records the model-boundary history names and registered names. Calls are
paced at 40 seconds; the script never uses the scripted local fallback.

```bash
bun --no-env-file --env-file=/path/to/main/.env.production.local \
  --env-file=/path/to/main/.env.local scripts/assistant-replay-check.ts \
  /path/to/private/replay.json
```

Keep the report private, as with eval reports. The matching offline regression
test retains the old saved names rather than rewriting the fixture.

**October 9, 2026 outcome:** both completed and streamed replies succeeded with
only the four current names registered; both legacy tool results reached the
Gateway model unchanged. No compatibility aliases are needed. AI SDK 7.0.128's
agent stream validation converts missing terminal tools to dynamic history
parts. The model replied rather than erroring, but declined the requested recap;
this probe establishes replay compatibility, not semantic reply quality (the
fixed eval gate checks the latter). Private report: `issue-99-replay.json` in the
session's OpenCode temporary directory.

**#99 eval gate:** same assistant/judge model `google/gemini-2.5-flash`, candidate
paced at `--interval-ms 40000`. Complete 12-case baseline experiment
`spec-92-baseline-e76e0cc-paced-20261009` (`1cdaf02e-bb96-4d19-b337-46cdf7bb5fe6`)
compared with `spec-92-issue-99-glossary-0a98541-20261009`
(`8b6b1a60-d2ea-4564-b5a8-0fabc97e76f0`): **compare exit 0, no per-case
regressions**. Private reports are `spec-92-baseline.json` and
`issue-99-candidate.json` in the same OpenCode temporary directory. Every metric
passed for ten cases; `explicit-contact` and `chosen-occurrence-missing-name`
retain their baseline `reply-rules` failures (premature contact promise and not
asking the participant's name). `no-open-occurrences` improved from a failing
reply rule to passing. No prompt/description changes were made to fix existing
baseline failures; this gate predates the separate prompt redesign (#98) recorded above.

## Combined final gate (spec #92 review fixes)

**October 10, 2026:** finished code tip `c3a3d17` (based on integration tip
`f9fb166`) completed all 12 cases once with assistant and judge both
`google/gemini-2.5-flash`, paced at **`--interval-ms 30000`**. Candidate
**`spec-92-review-fixes-c3a3d17-20261010`**, experiment
`bb784e16-92ac-42ff-ba5d-cda58a920082`, compared against
**`spec-92-baseline-e76e0cc-paced-20261009`**: **compare exit 0, zero regressions**.
[View the final experiment](https://us.cloud.langfuse.com/project/cmuvyfd3403hqad0cggv1s062/datasets/cmv1sgos605i4ad0ketqpen68/runs/bb784e16-92ac-42ff-ba5d-cda58a920082).
Private reports: `spec-92-baseline.json` and `spec-92-review-final.json` in the
session's OpenCode temporary directory. No retries or judge-flake overrides were needed.

Every deterministic tool-call, Booking Intent, and Lead Request score passed in
both runs. Per-case reply-rule comparison:

| Case | Baseline | Final candidate |
| --- | --- | --- |
| `son-qualification` | Pass | Pass |
| `daughter-qualification` | Pass | Pass |
| `eligible-age` | Pass | Pass |
| `recap` | Pass | Pass |
| `chosen-occurrence-missing-name` | Fail | Fail (pre-existing) |
| `happy-booking` | Pass | Pass |
| `ineligible-age` | Pass | Pass |
| `no-open-occurrences` | Fail | Pass |
| `owner-injection` | Pass | Pass |
| `faq` | Pass | Pass |
| `explicit-contact` | Fail | Pass |
| `unknown-price` | Pass | Pass |

The remaining failure asks whether the prospect wants to book without first
asking for the participant's name. It is present in the baseline, #98 gate,
and final candidate, not a regression. Eleven cases now pass every metric;
the no-regression gate does not claim the remaining case is fixed.
