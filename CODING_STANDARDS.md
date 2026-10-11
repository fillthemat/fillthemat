# API error-handling and observability

These rules apply to new or changed API failure paths and their client callers. Existing gaps are not precedents: [booking reporting #110](https://github.com/fillthemat/fillthemat/issues/110) is the focused follow-up applying this contract, not a prerequisite or a repo-wide migration.

## HTTP and ownership

- Routes MUST remain thin HTTP adapters: validate input, call a domain interface, map its result to HTTP. The database-import restriction is already enforced by `.oxlintrc.json`.
- Expected validation/domain refusals MUST use explicit status/stable-code mappings documented in the route or shared protocol.
- Changed mappings MUST preserve existing caller contracts.
- Malformed JSON MUST be a client error (400 `invalid`), not an uncaught 500.
- Codes MUST NOT come from exception prose.
- Unexpected exceptions MUST be handled at one owning boundary covering request processing, including lookups and side effects.
- Before a response is committed, unexpected exceptions MUST return safe JSON 500 `internal_error`.
- After a response is committed, handling MUST preserve its committed status and headers. This includes streamed responses: a later failure cannot replace them with JSON 500; terminate or signal failure through the existing stream protocol without falsely claiming successful completion.
- Explicitly degraded/best-effort work MUST have an observable stable outcome (for example, a persisted retry plus a safe diagnostic).
- Delivery failure MUST NOT claim a committed booking rolled back.
- Delivery failure MUST NOT claim delivery succeeded.
- Recovery MUST NOT retry the primary operation in a way that duplicates it.

Existing examples: `src/app/api/chat/route.ts` handles malformed JSON and exhaustively maps domain refusals; `src/lib/chat/protocol.ts` owns shared public codes. The route also maps `invalid_message` by comparing a Zod issue message to an intentionally shared code, not arbitrary exception prose. That message coupling is not a recommendation to derive public codes from exception messages; prefer a dedicated discriminator. These illustrate only the named patterns, not full compliance with the new reporting contract.

## Correlation and log shape

- At request entry, before early refusals, the server MUST generate a fresh opaque request ID (for example, `crypto.randomUUID()`).
- Error JSON MUST contain `{ error: <stable code>, requestId: <server ID> }`.
- Any failure diagnostic and client support reference MUST use that same ID.
- Success metadata MAY include the request ID without changing existing success semantics.
- Request context MUST be request-local or explicitly passed, never shared mutable context across concurrent requests.
- Arbitrary inbound IDs, tokens and PII MUST NOT become correlation IDs.
- Unexpected and explicitly degraded failures MUST each emit one structured diagnostic at their owning boundary, including failures after response commitment; they MUST NOT be silently swallowed.
- Expected refusals (such as 409/429) MAY emit a diagnostic when operationally useful.
- Each failure MUST be logged at most once, not catch-and-log at every layer.
- Each diagnostic record MUST be a structured object or JSON record with `event`, `operation` (stage), `requestId`, `method`, `route` (static path/template, not query text), `status`, `error` (stable code), and `diagnostic` (allowlisted classification or `unknown`).
- Records MUST include trusted deployment context when available, using `deploymentEnvironment` for the environment and `deploymentId` for the deployment ID.
- Unavailable deployment fields MUST be omitted rather than read from request headers.
- Diagnostics MUST explicitly select safe fields.
- A reviewed classifier MUST preserve useful allowlisted root-cause codes, including wrapped causes (for example, database `42703`).
- Classifiers MUST map unrecognized values to `unknown`; a code-shaped string alone is not an allowlist.

There is no shared HTTP request logger required by this contract; direct structured logging is sufficient. `src/lib/retry-log.ts` illustrates only explicit field selection instead of serializing a database row. Its `reason` regex is not a diagnostic allowlist, and its queue-specific shape is not the HTTP shape above; it is not a privacy/classifier compliance example.

## Application-log privacy

- Application logs MUST NOT contain names, ages, contact details (email/phone), IPs, conversation/message text, request bodies, SQL/parameters, provider payloads, headers/cookies, bearer/resume/session/Turnstile tokens, idempotency keys or other secrets.
- Raw Error/query/provider/request objects and arbitrary messages/stacks MUST NOT be dumped without a reviewed sanitizer satisfying these exclusions.
- Internal identifiers (for example, a resolved school ID) MAY be included only with an explicit allowlist and an operational justification; logging a whole row is not justified by one safe field.
- These application-log rules MUST NOT silently change Langfuse trace capture/retention policy.
- Trace changes MUST receive separate review against `docs/conversation-debugger-plan.md` and `src/lib/tracing/`.
- Trace payloads MUST NOT be copied into application logs unless they satisfy the application-log privacy rules.

## Client callers

- Clients MUST safely inspect non-2xx bodies as untrusted data.
- Clients MUST map each supported code to actionable copy.
- Clients MUST use a safe fallback for unknown codes, non-JSON bodies and malformed envelopes.
- A valid provided request ID MUST be displayed as a support reference.
- Clients MUST NOT fabricate server IDs for network failures.
- Clients MUST catch network/parsing failures.
- Clients MUST restore pending state on every exit.
- Success callbacks/navigation MUST run only after a validated successful response.
- Dependent requests MUST NOT proceed after a failed/invalid prerequisite (including an idempotency-key request).

## Examples (synthetic only)

These are contract sketches, not references to unimplemented helpers. For both log records below, a real boundary generates the ID; `synthetic-request-1` is only a fixture.

| Case | Good | Bad |
| --- | --- | --- |
| Expected refusal | 409 `{ "error": "slot_unavailable", "requestId": "synthetic-request-1" }` | 500 with exception prose for a full trial occurrence |
| Unexpected exception | 500 `{ "error": "internal_error", "requestId": "synthetic-request-1" }` plus the failure record below | Return/log the raw exception or its SQL |
| Degraded delivery | Preserve the committed booking, persist retry state, emit `delivery.degraded` below | Return “booking failed” after commit, or silently discard delivery failure |
| Client fallback | Unknown/non-JSON response → “We couldn't confirm your booking. Please try again.”; append a provided support reference | Render raw response text, invent an ID, or invoke `onBooked` on failure |

```json
{
  "event": "request.failed",
  "operation": "booking.create",
  "requestId": "synthetic-request-1",
  "method": "POST",
  "route": "/api/bookings",
  "status": 500,
  "error": "internal_error",
  "deploymentEnvironment": "test",
  "diagnostic": { "kind": "database", "code": "42703" }
}
```

```json
{
  "event": "delivery.degraded",
  "operation": "booking.confirmation_delivery",
  "requestId": "synthetic-request-1",
  "method": "POST",
  "route": "/api/bookings",
  "status": 200,
  "error": "delivery_retry_pending",
  "diagnostic": "unknown"
}
```

## Tests and Standards-review checklist

Changed failure paths MUST have deterministic tests using real Requests at the HTTP adapter and narrow dependency seams (see `src/app/api/chat/route.test.ts`), without live vendors or production access. Reviewers MUST verify:

- [ ] Expected status/code mappings, malformed JSON and unexpected failures are tested.
- [ ] Success/idempotency behavior remains intact.
- [ ] Response, any log and visible support reference correlate.
- [ ] Early refusals and concurrent requests have independent server IDs.
- [ ] One owning boundary logs unexpected/degraded failures once; expected-refusal logging is optional.
- [ ] Degraded side effects remain observable without misreporting primary-operation outcomes.
- [ ] Post-commit failures preserve response status/headers without claiming a failed stream completed successfully.
- [ ] Minimum log fields, including available trusted deployment context, are present.
- [ ] Wrapped allowlisted diagnostic codes survive classification.
- [ ] Sensitive sentinels in exceptions/causes are absent from serialized logs/error responses.
- [ ] Clients test every known code and unknown/non-JSON/malformed bodies.
- [ ] Clients test failed prerequisites and thrown fetch/parse failures.
- [ ] Pending state recovers on every exit.
- [ ] Success callbacks/navigation run only on validated success.
- [ ] Privacy exclusions hold.
- [ ] Any new identifier/classifier/sanitizer is explicitly justified.

Skip findings already enforced by tooling.
