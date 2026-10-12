# WhatsApp channel — school-owned connections

Source of truth: [spec #188](https://github.com/fillthemat/fillthemat/issues/188), implemented by #189–#199. [ADR-0005](adr/0005-school-owned-whatsapp-accounts.md) **supersedes D9 (shared WABA)**, decision C's shared account, decision G's shared templates, and D10's manual phone-ID toggle in the [historical phase plan](archive/whatsapp-shared-account-plan.md). The first real school must go Live through this flow, not through the historical setup.

## Ownership and onboarding

- Fillthemat is a Meta Tech Provider on direct Cloud API, using Embedded Signup v4 with no Solution Partner.
- Each school owns its WhatsApp Business account (WABA). One Fillthemat app and webhook serve every school; only the app signing secret and webhook verify token stay global.
- An approved, published school with a school phone and **public contact email** can enable WhatsApp from Settings. The private notification email is not a public contact address.
- Enable reserves a new US AgentPhone number. Fillthemat pays its rental; the owner's existing number is untouched. The owner signs into Meta, chooses/creates the school's business, and types the six-digit carrier verification code displayed in Settings into the popup.
- Completion exchanges the short-lived code server-side for a customer-scoped token, verifies the school's assets, subscribes the app, registers the number, and sets the school's profile. Tokens are encrypted with school-bound AES-256-GCM and never exposed in page data.
- The owner adds their own payment card in WhatsApp Manager; Meta bills the school directly. **Live requires both registration and a payment method.** No template approval gates Live. Do not promise free replies: verify current US pricing in the pilot (replies became billable October 1, 2026).
- Cancelled/failed signup keeps the reserved number for resume. Settings shows the checklist, number, OTP, card link, retries, and Live sharing links/QR code. The public school page only advertises WhatsApp while Live.

## Routing and sending

Inbound `metadata.phone_number_id` resolves to the school. Verified wamid deduplication, school-scoped conversations, single-flight generation, quotas, and durable queues remain. WhatsApp and web conversations have an explicit channel and are readable only by their school's signed-in owner in the read-only Conversations tab.

Every text, interactive send, read receipt, and typing indicator uses **that school's credential**. Missing, expired, corrupt, or wrong-school credentials must never become shared access. Production fails closed; only non-production may log a no-op when the school has no credential.

The Assistant only replies within the prospect's 24-hour customer-service window, derived from the verified inbound timestamp, never retry processing time. It never starts a WhatsApp conversation. Booking confirmations are plain in-window replies; reminders remain email-only. When asked for a person, the Assistant offers the school's phone and public contact email; Lead Requests remain available.

**No shared template registry or template sender remains.** Historical template columns and message/queue rows are retained, not dropped. Pending legacy template deliveries stop permanently with `template_retired`; non-stale legacy booking confirmations use the existing atomic, idempotent owner follow-up email. They are not silently discarded or converted to an out-of-window send.

## Lifecycle and failures

The connection module alone owns lifecycle writes; Settings, webhooks, and jobs call its commands. States: Off, buying, popup, cancelled, popup-failed, failed, needs-card, registering, Live, cooling, released, and broken (card/access/restricted/number).

Only Live connections receive Assistant replies, including at delivery time. Broken connections show the failed part and recovery action. Switch-off stops the Assistant and starts 30 days' cooling-off; during cooling, inbound texts receive only a deterministic reply with the school's phone/email. Switching on in time keeps the number. After release, old links and QR codes stop working; enabling again buys a new number. Released numbers are never reused by Fillthemat, and conversation history remains attributed to the school.

Durable work retains the existing [bounded retry policy](decisions/whatsapp-retry-limits-research.md): five started executions, fresh/retry claim lanes, fenced claims, non-regressing status callbacks, terminal `dead`, and 10/20/40/80-second retries within a four-minute active run. A stale booking confirmation stops at class start without owner mail; other terminal confirmation failures enqueue one owner email. Ordinary replies never trigger that email. The webhook's `after()` wake remains the fast path; the Hobby-safe daily cron is the safety net ([wake decision](decisions/whatsapp-cron-after.md)). No sub-daily Hobby cron or new operator-alerting claim.

## Configuration and local development

See [local development](local-development.md) and [the pilot runbook](whatsapp-phase6-kickoff.md). Global configuration is `WHATSAPP_APP_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID`, `WHATSAPP_TOKEN_ENCRYPTION_KEY`, and optional API-version/base overrides; AgentPhone supplies number rental and OTP receipt. `WHATSAPP_SYSTEM_USER_TOKEN` is obsolete and ignored: remove it from deployment environments after cutover.

The local demo is approved but unpublished, has a public contact email, and starts with a normal **Off** connection, no fabricated WABA or phone ID. Re-running setup preserves owner connection progress and only clears the historical unconnected demo mapping. Missing carrier/Meta configuration reports setup unavailable; integration tests inject fake external clients. Publishing does not automatically make WhatsApp Live. No paid vendor account or second database stack is needed for tests.

## WhatsApp data is not shared-model training data

**WhatsApp conversations must not be used to train, fine-tune, or improve shared models**, including anonymized, derived, or pooled-school data ([Meta terms §4.7](https://www.facebook.com/legal/Meta-Terms-for-WhatsApp-Business-Platform)). School-specific inference does not grant training rights. Do not promote WhatsApp traces into shared evaluation/training datasets.

Repository inspection confirms the worker performs inference, not training: `src/lib/ai/language-model.ts` uses AI Gateway (default `anthropic/claude-sonnet-4.6`); tracing exports masked turn data to Langfuse under ADR-0001/0002; `scripts/assistant-eval.ts` seeds checked-in cases rather than automatically harvesting WhatsApp conversations. That is **not proof** of deployed model-provider, Gateway routing, Langfuse account settings, or external export policies. Before real traffic, the operator must record no-training terms/settings for every actual processor and verify no WhatsApp-derived evaluation/export dataset exists. Masking alone is not sufficient. This operational audit is an explicit pilot gate, not a completed attestation.

## Verification and pilot status

Run `bun run verify`; database-backed tests are separate (`bun run test:integration`). The pre-agreed seams in #188 are the worker/transport, connection commands with fake external clients, and owner conversation queries, plus the mocked Settings browser happy path.

**Real-school pilot: pending, not executed by this implementation.** Use [the runbook](whatsapp-phase6-kickoff.md) to record a school going Live through owner Settings/Embedded Signup, customer-scoped assets/token, billing, cold inbound text, delivered plain booking confirmation, status callbacks, isolation and lifecycle recovery. Do not mark #199's real-school acceptance or processor no-training audit complete based on local tests.
