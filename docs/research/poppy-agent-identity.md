# Poppy agent identity and CAPTCHA-free booking writes

Research for [#158](https://github.com/fillthemat/fillthemat/issues/158), under map [#122](https://github.com/fillthemat/fillthemat/issues/122); input to the unresolved consent/abuse decision [#127](https://github.com/fillthemat/fillthemat/issues/127).

**As of 2026-10-11. Primary sources only. No policy decision or implementation.** Poppy pages identify themselves as Draft 0.1, updated October 9, 2026. Protocol and vendor behavior are version-sensitive; findings below distinguish requirements, recommendations, and our security inferences. [P1–P4]

## Bottom line

Poppy supplies a useful authenticated **client identity**, an **agent-asserted user pseudonym**, and **proof of possession of a Session key**. It does not supply verified human identity, unique-person enforcement, or independently witnessed consent. Anyone able to publish suitable HTTPS metadata and keys can introduce a new `client_id`; admission policy and quotas determine whether that new identity can write. DPoP stops use of stolen tokens without their keys, not abuse by their legitimate holder. [P1, P2, O1]

There is no single CAPTCHA equivalent that proves an automated booking is legitimate. The alternative is a stack: authenticated clients + admission/reputation + tenant/user/client resource budgets + exact-action confirmation + replay/idempotency protection, with optional direct human/contact confirmation. Web Bot Auth and vendor verified-bot directories add provenance signals, not booking authorization or human approval. [P1–P4, W1, C1, V1–V3]

## 1. What Poppy actually identifies

### 1.1 Client metadata and operator keys (§4.1)

- `client_id` **MUST be an HTTPS URL returning the client's metadata document**, and the document's `client_id` must equal the fetched URL. Metadata includes the agent's self-chosen name/logo, `jwks_uri`, redirect URIs, authentication method, and optionally extensions. `jwks_uri` and every redirect URI must be HTTPS on the same domain as `client_id`; only public keys are published. [P1]
- At the token endpoint the agent authenticates using **`private_key_jwt`**, a client assertion signed with a key from the verified `jwks_uri`. The same published keys sign Session assertions. **DPoP keys are separate and not published in this key set.** Do not confuse client authentication with the JWT bearer grant that asserts the User ID: Session creation uses both. [P1, P2]
- The Company **MAY require advance registration**; its procedure is outside Poppy. An unregistered, blocked, revoked, malformed, or unverifiable client is rejected with `invalid_client` (401). Metadata discovery is not itself registration approval, and Poppy does not require an open dynamic-registration endpoint. [P1, P2]
- Companies may allowlist/blocklist/revoke by `client_id`, rate-limit Session creation by client, and limit the number of new client IDs they accept if registration is not required. [P1]
- The company guide recommends fetching `client_id` **without redirects**, bounded metadata/JWKS caching, safe network fetching, and rate-limited refresh for unknown key IDs. Arbitrary metadata is an SSRF and resource-exhaustion surface, not harmless configuration. The OAuth CIMD draft also requires exact URL comparison, no automatic redirects, special-use-address rejection in production, and limits on response size. [P4, O1 §§3, 5, 8.6–8.7]

**Proof boundary:** a successful verification establishes that the request signer holds a private key whose public key was published through this HTTPS metadata location. The name and logo are self-asserted. This is not legal-entity vetting, model provenance, a software integrity attestation, or evidence that every user of a trusted agent is benign. Even the HTTPS domain is not a unique-person credential. A third-party software statement or operator vetting could add assurance, but is not supplied by baseline Poppy. [P1, P4, O1 §§4.3, 8.3–8.9; security inference]

### 1.2 User pseudonyms and signed-out Sessions (§4.2)

The agent assigns each User a **stable, opaque ID per Company**, where Company means `auth.issuer`. IDs must differ between Companies and must not contain or derive from email, phone, name, or other personal information, even through keyed hashing. The guide permits stored random IDs or HMAC of an already-random internal ID plus the issuer. [P2, P4]

Starting a Session sends:

1. A JWT bearer grant assertion: `iss = client_id`, `sub = Company-specific User ID`, `aud = token_endpoint` (a single string), short lifetime, unique `jti` with at least 128 random bits.
2. A separate client authentication assertion (`private_key_jwt`).
3. A DPoP proof for the token request (except the special MCP Bearer flow).

The Company verifies both assertions, matches the authenticated client to `iss`, and rejects reused Session-assertion IDs. Renewal must match the original Session's client and User ID. Signed-out tokens have **no account scopes**; the response says `signed_in: false`. They are not an implicit `poppy:write` grant. Companies may allow guest actions without an account, but must define those permissions themselves. [P1, P2, P3; spec §§4.4, 6]

**Namespace consequence for Fillthemat:** use verified `(School issuer, client_id, User ID)` as the pseudonymous user principal, not `sub` alone. IDs asserted by two clients are not proven to name the same person. Two Schools' distinct issuers also deliberately prevent correlation by User ID. A Session ID or DPoP key is not an appropriate durable user quota key: one user can start parallel Sessions, and can rotate DPoP keys. [P2, P3, P4; design inference]

**Sybil boundary:** a conforming honest agent promises stable IDs, but a malicious signer can invent new `sub` values. A blocked operator can serve a new metadata URL/domain with new keys. Buying a domain is not required for every identity: distinct metadata paths on a controlled domain can also produce distinct client IDs. Per-client and per-user budgets therefore constrain cooperative/known clients, not a determined attacker with unlimited new identities. Domain/operator grouping, a new-client admission budget, and School-wide budgets can supplement exact-ID quotas; none should be presented as a uniqueness proof. [P1, P2, O1 §§3, 8.3, 8.9; security inference]

### 1.3 DPoP (§4.3)

For conversations and the planned OpenAPI API, the client **MUST send `Authorization: DPoP <token>` and a fresh DPoP proof**. The Company binds the token to the key in the token-request proof. It checks signature, bound key, method (`htm`), public URL (`htu`, excluding query/fragment), freshness, unused `jti`, and token hash (`ath`). Token-endpoint proofs have no `ath`. Companies may require nonces, and clients must support them. [P3]

DPoP keys are generated per User/Company and may be regenerated per Session. Guides call for a shared replay cache across all servers, public-origin URL reconstruction from configuration rather than an untrusted `Host`, roughly minute-scale acceptance windows, and continued replay checks even when nonces are used. Existing map #122 already calls for tenant-bound Sessions and Postgres replay storage; this research adds no database design. [P3, P4, map #122]

**Proof boundary:** DPoP is token/key possession and request binding, not human presence or approval. It does not sign the request body or query terms. Use TLS, server-owned immutable Booking Intent terms, ownership checks, and explicit revision confirmation for business effects. A valid key holder can deliberately send different bookings with fresh proofs. Replay protection and business idempotency solve different problems. [P3, P5, W1 §5.2; security inference]

Bearer Session Tokens are an explicit **MCP-only exception**, resource-bound to one MCP server; Companies must require DPoP elsewhere. A Poppy conversation/OpenAPI booking endpoint must not accept Bearer tokens as a convenience fallback. [P3]

## 2. Approval: the Operations extension, not ordinary chat

Poppy's optional `operations` v1 extension is directly relevant to our existing **Assistant prepares; platform books** rule. It works across conversations and OpenAPI: propose exact terms, obtain approval, confirm one revision at the operations endpoint, then track the result. It is not automatic with Poppy; both parties advertise support. If an action requires it and the client lacks it, the Company can refuse with `extension_required` (403). [P5, P6; R3]

- The Company supplies immutable, versioned terms and a complete human-readable summary. It must not perform the action before confirmation, must accept only the latest non-expired revision, and must perform an operation **at most once** across channels. [P5 §§3, 5–6]
- `approved_by: user` means the agent claims the User saw and approved that revision. `standing_permission` claims an earlier permission covers every term. `user_approval_required: true` disallows standing permission, but **does not upgrade the statement into proof of human approval**. [P5 §§5, 8]
- A conversation message does not confirm an operation, even if it contains the User's words. Confirmation goes through the dedicated endpoint. Company-supplied text must never be treated as the User's answer. [P5 §§4.3, 5.1]
- A signed-out operation is usable **only in its originating Session**. Account-based recovery across Sessions is not available in our signed-out-only v1. Operation tracking and booking-status retention must account for this boundary; no lookup by guessed booking ID or email should bypass ownership. [P5 §3.2; design implication]

The extension's §8 states the limitation explicitly: a confirmation proves that a specific agent, holding the Session key, **stated** that the User approved specific terms. It does not prove they saw or approved them. The Company can revoke a dishonest client. If independent approval evidence is required, the Company can ask the User to approve on its own website, signed in; that additional step is not defined by the extension. [P5 §8]

For signed-out prospects, a first-party email/phone confirmation or short-lived confirmation page would therefore be **our own workflow**, not built-in Poppy consent. Contact-channel possession proves access to that channel, not a unique human or legal consent. Separate booking permission, truthfulness of contact details, and marketing permission in #127 rather than treating one agent confirmation as all three. [P5 §8; proposed control/security inference]

## 3. What standards and vendors use instead of human challenges

### 3.1 IETF Web Bot Auth / HTTP Message Signatures

**RFC 9421 is the published HTTP Message Signatures building block. Web Bot Auth is still work in progress**, specifically `draft-ietf-webbotauth-httpsig-protocol-00`, published September 1, 2026. It profiles signed automated HTTP requests, `Signature-Agent` key discovery, JWKS, and a well-known directory; it is not a human-authentication or consent standard. [W1]

A verifier resolves the advertised HTTPS key location and validates `Signature` / `Signature-Input`. The useful result is a URL/key association usable for logging, limiting, allowlisting, and blocking. The draft explicitly says this does not prove benignness, operator identity, request authorization, or human identity, and does not stop an agent abandoning a URL for another. [W1 §§4, 7]

Important write-path limitations:

- Baseline signatures can cover only the authority plus identity field. That can be valid for different methods, paths, and bodies at that authority until expiry. Method/path/target URI are additional coverage; a body requires a covered `Content-Digest`. The profile itself does not require the body digest or a replay database. **Do not interpret an edge “verified bot” result as approval of this booking body.** [W1 §§5.2–5.3]
- The current draft supports dictionary-form `Signature-Agent`, and discovery types `directory`, `jwks_uri`, and `cimd`. CIMD can reuse the metadata discovery vocabulary, but this is not an automatic bridge from a vendor bot identity to a Poppy `client_id`, User ID, or Session. Independently validate the Poppy principal; any mapping to a vetted operator is policy/configuration. [W1 §5.5; design inference]

### 3.2 Cloudflare verified bots / signed agents

Cloudflare combines identification (Web Bot Auth signatures, IP list plus stable User-Agent, or reverse DNS) with admission/reputation review. Its current docs say **signed agents were folded into Verified bots on July 1, 2026**. BotBase now distinguishes Direct operators from Intermediary services used by many end users, and behaviors such as Agent and Transact. These classifications are not all standalone WAF fields; legacy rule categories remain supported. A trusted intermediary does not imply trusted end users. [C1]

For its deployed Web Bot Auth implementation, operators register a key directory and Cloudflare verifies approved **Ed25519** keys. It still uses the older quoted-string `Signature-Agent` format and explicitly rejects the newer dictionary form. It recommends short expiries but currently **does not validate nonces or keep a seen-nonce database**. These are documented differences from the evolving IETF draft, not theoretical edge cases. [C2]

Implication: edge verification is useful for narrowly exempting known agent traffic from browser challenges, while maintaining application authentication, quotas, and replay checks. Do not globally skip security for all verified bots, and do not trust caller-supplied headers claiming a verified result. The experimental `Forwarded` mechanism is not a stable authenticated human-identity solution. Turnstile's presence in our app does not imply requests already traverse Cloudflare bot verification. [C1, C2; R1; architecture/security inference]

### 3.3 Vercel BotID / verified bots

**BotID is itself an invisible CAPTCHA**, with a browser-side challenge, server `checkBotId()`, and optional paid Deep Analysis. Replacing Turnstile with generic BotID is not a CAPTCHA-free protocol for arbitrary backend Poppy clients. Its useful agent feature is verified-bot handling: `isVerifiedBot`, `verifiedBotName`, and `verifiedBotCategory`, with an example allowing only verified `chatgpt-operator`. [V1, V2]

Vercel's curated directory verifies bots using IP, reverse DNS, and Web Bot Auth; signed verified bots can pass Bot Protection/Challenge Mode. This is a compatible optional hosting-layer signal for known services, not proof that a new independent Poppy agent should be denied or that a known agent may bypass booking business rules. A directory allowlist and a Poppy client allowlist are different identities and must not be silently conflated. [V2, V3; design inference]

### 3.4 OpenAI, Anthropic, Google: identification is product-specific

| Provider / traffic | First-party documented identification | Booking-write implication |
| --- | --- | --- |
| OpenAI Cloud browser | Web Bot Auth with quoted `Signature-Agent: "https://chatgpt.com"`; public keys at its well-known directory; CDN integrations include Cloudflare, Akamai, HUMAN, and Vercel (`chatgpt-operator`). [A1] | Authenticate signatures/edge results, not the header string alone. The current help page says this Cloud browser cannot sign in to sites or complete payments at launch; do not infer all OpenAI browsing products share capabilities or Poppy support. |
| OpenAI `ChatGPT-User` | Separate user-triggered traffic with a User-Agent and published IP list; distinct from GPTBot training and OAI-SearchBot indexing. [A2] | A crawler/fetcher allowlist is not a write credential or proof of a booking instruction. |
| Anthropic `Claude-User` | User-initiated website retrieval; official docs distinguish it from ClaudeBot and Claude-SearchBot, honor robots.txt/crawl-delay, and now link an official IP list at `https://claude.com/crawling/bots.json`. [A3] | Older claims that Anthropic publishes no IP list are stale. This source documents retrieval, not a universal signed-agent write/approval scheme; it does not establish a Poppy integration. |
| Google `Google-Agent` | User-directed browsing/actions, published `user-triggered-agents.json`; experimental Web Bot Auth identity `https://agent.bot.goog`. Signed requests use dictionary member `g="https://agent.bot.goog"`. **Only a subset of requests is signed**; Google recommends fallback network verification. [A4, A5] | Do not require every Google request to have a signature for general bot classification. Conversely, never let an unsigned claimed identity bypass Poppy authentication for booking writes. Google's dictionary form also conflicts with Cloudflare's currently documented quoted-string-only verifier. |

None of these cited identification pages defines a universally interoperable human-approval receipt. OpenAI's historical ChatGPT agent launch describes explicit confirmation and browser takeover as product safeguards, but the page now marks itself outdated. That is evidence of a vendor UX approach, not a current guarantee or a verifier-visible consent artifact. Poppy Operations is clearer about what the Company can actually verify. [A1–A6, P5]

## 4. Fillthemat constraints and layered write-path options

### 4.1 Existing constraints, not new decisions

Map #122 specifies one School per Company/issuer, our own minimal signed-out handlers, conversations first, and a small OpenAPI trial-occurrence/create-booking/status API next. Signed-out Users have no prospect accounts to authenticate. #127 remains responsible for deciding whether an agent's confirmation counts as Contact consent and what restrictions apply. [map #122, #127; task context]

At research baseline `9004dcc`, `src/lib/security/turnstile.ts` verifies a supplied token with Cloudflare Siteverify and fails closed without a secret. `limits.ts` defines **6 bookings per school/email over a rolling 24 hours**, **12 email deliveries per school/recipient over 24 hours**, conversation/message/body limits, and separate WhatsApp budgets. These email caps do not prove control of the submitted email and do not prevent rotating recipients. `docs/known-gaps.md` records missing per-School/per-IP reservation quotas. Email send budgets are not seat-reservation quotas. [R1, R2; security inference]

The repo rule is **the Assistant prepares; the platform books**. Agent-specific traffic should not be implemented as a caller-controlled `isAgent` flag that bypasses the existing web write gate. Both channels need the same business checks; only their evidence/admission paths differ. [R3; proposed implementation constraint]

### 4.2 Common layers to evaluate for every option

These are concrete design candidates for #127, not landed requirements or chosen thresholds:

1. **Separate evidence paths.** Keep existing web Turnstile protection; admit Poppy requests only after verified client assertions and School-bound Session/DPoP checks. Reject malformed agent credentials rather than falling back to anonymous web writes. Protect status reads with the same ownership boundary. [P1–P3, R1; proposal]
2. **Admission before expensive work.** Decide registered/allowlisted vs open clients; bound new-client acceptance, metadata/JWKS fetches, token minting, and failed authentications. Safely fetch metadata with no client-document redirects, SSRF protections, bounded sizes/timeouts, caching, and capped unknown-`kid` refresh. Check revoked clients/Sessions at request time. [P1, P4, O1; proposal]
3. **Layer quotas by distinct resource.** At least evaluate global + School reservation budgets, `(issuer, client_id)` request/write budgets, `(issuer, client_id, User ID)` budgets across Sessions, Session/conversation/LLM budgets, contact-recipient email budgets, and coarse trusted-source-IP burst limits. Add per-occurrence inventory/hold limits. Rate-limit failed proposals and confirmation attempts too; enforce before model work and downstream emails. Use 429 + `Retry-After`; the guides additionally recommend draft `RateLimit` headers. [P3, P4, R2; proposal]
4. **Do not solve sybils with one counter.** Client/User-ID rotation defeats exact-principal-only quotas; aggregate School/global ceilings bound damage regardless. Group known metadata URLs under a vetted operator where justified, not indiscriminately across shared hosting domains. IP is a secondary network/cost signal, often a shared vendor egress address rather than the human. No counters imply verified personhood. [P1, P2, O1, W1 §§2, 4, C1; proposal/inference]
5. **Exact action and concurrency safety.** Preserve Booking Intent preparation; confirm only immutable latest terms, correct School/occurrence/contact, active owner Session, and allowed approval mode. Enforce capacity, idempotency, and quota consumption atomically with the booking effect; consume no second quota/seat/send on a replay. Fresh DPoP proofs alone are not business idempotency. Do not hold scarce seats merely because an agent requested an unconfirmed proposal without explicit hold budgets/expiry. [P5, R3; proposal]
6. **Evidence, minimization, revocation.** Record verified client/User/Session references, operation ID/revision, confirmation time/mode, outcome, and enforcement reason without logging tokens, proofs, keys, contact details, or full prompts as security telemetry. Keep required booking/contact data in its existing business storage. Make School-level shutoff and client revocation possible; decide whether abuse revokes existing Sessions as well as new admission. [P1, P4, P5; proposal]

### 4.3 Options and trade-offs (no selection)

| Option | Concrete write path on top of the common layers | Benefit | Residual risk / cost |
| --- | --- | --- | --- |
| **A. Registered-client pilot + Operations** | Admit vetted exact client IDs; require Operations v1, `user_approval_required: true`, and confirm a Booking Intent revision before booking. | Small attack surface; accountable operators; clear cross-channel terms and at-most-once recovery. Permitted by Poppy. | Trusts the operator's human-approval assertion; registration friction and independent-agent exclusion; key/operator compromise and malicious end users remain. [P1, P5] |
| **B. Open clients with bounded admission and tiered privileges** | Any valid metadata/key may start a limited Session; new clients get lower request/School write budgets, with first booking or suspicious traffic requiring contact confirmation or review. | Better independent-agent interoperability; keeps discovery and read/chat access open. | New URL/domain/User-ID rotation; more metadata attack exposure and operational review; rate limits alone do not prove approval. Aggregate caps can cause denial of service for honest prospects. [P1, P4, O1; proposal] |
| **C. Direct prospect confirmation before reserving** | Agent proposes; Fillthemat sends a short-lived, single-use confirmation link/code to the submitted contact channel, bound to School + operation + revision. Book only after explicit first-party confirmation; GET/prefetch must not perform the write. Limit sends and pending proposals. | Adds independently observed contact-channel possession and a concrete affirmative action; does not require a prospect account. | Extra round trip/conversion friction; mail/SMS cost and abuse; compromised/shared inboxes and agent-accessible mail mean it still is not proof of a unique human. Entirely our signed-out workflow, not Operations' defined signed-in approval step. [P5 §8, R2; proposal/inference] |
| **D. Vendor provenance as an additional signal** | Narrowly exempt approved verified agent services from browser challenges at Vercel/Cloudflare; still require Poppy auth + quotas + an A/B/C approval path. Explicitly configure mapping between vendor identity and admitted Poppy client if needed. | Offloads known-provider provenance and network abuse filtering; Vercel fits existing hosting. | Vendor dependency/directory coverage and evolving wire formats; does not identify the human or authorize a booking; overly broad skip rules open a bypass. Not a substitute for A/B/C. [C1, C2, V1–V3] |
| **E. Pending request / School review for unknown or high-risk clients** | Accept a bounded Lead Request or pending Booking Intent, but do not reserve capacity until contact confirmation or School approval. Known clients may have a different path. | Limits immediate seat hoarding; supports legitimate newcomers without unconditional booking access. | School workload, delayed conversion, and pending-request spam remain; needs strict queue/notification budgets. This is a product workflow to decide, not a Poppy guarantee. [R2, R3; proposal] |

**Questions left to #127:** open vs registered clients; trusted-agent consent vs first-party confirmation; standing permission allowed or not; reservation/hold budgets and thresholds; what unknown clients can do; School override/shutoff; status access after a signed-out Session ends; separate trial-booking and marketing permission; retention of confirmation evidence. None is resolved here. [#127, P2, P5; decision checklist]

## Sources

All external sources are first-party protocol, standards, or vendor documents read for this research. Search snippets/third-party explanations were used only for discovery, not evidence. Pin IETF draft revisions rather than assuming future text matches this note.

- **P1:** [Poppy Draft 0.1 §4.1, Agent identity](https://personalagentprotocol.org/docs/spec#agent-identity).
- **P2:** [Poppy §4.2, Starting a Session](https://personalagentprotocol.org/docs/spec#starting-sessions), with [§3.2, Company issuer identity](https://personalagentprotocol.org/docs/spec#oauth-server).
- **P3:** [Poppy §4.3, Using Session Tokens](https://personalagentprotocol.org/docs/spec#sending-tokens); [§4.4, signed-in scopes](https://personalagentprotocol.org/docs/spec#sign-in); [§6, APIs](https://personalagentprotocol.org/docs/spec#apis).
- **P4:** [Poppy Guides](https://personalagentprotocol.org/docs/guides), especially safe metadata fetching, user IDs, rate limits, verifying agents/DPoP, guest access, and secrets. Guides are recommendations unless repeating a specification MUST.
- **P5:** [Operations extension v1](https://personalagentprotocol.org/docs/extensions/operations), especially [§8, What a confirmation proves](https://personalagentprotocol.org/docs/extensions/operations#proof).
- **P6:** [Poppy Extensions](https://personalagentprotocol.org/docs/extensions).
- **O1:** [OAuth Client ID Metadata Document, draft-ietf-oauth-client-id-metadata-document-02](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-client-id-metadata-document-02), July 6, 2026; work in progress, not an RFC. Poppy adds stricter same-domain/private-key rules to this generic mechanism.
- **W1:** [HTTP Message Signatures for automated traffic, draft-ietf-webbotauth-httpsig-protocol-00](https://datatracker.ietf.org/doc/html/draft-ietf-webbotauth-httpsig-protocol-00), September 1, 2026; work in progress, built on [RFC 9421](https://www.rfc-editor.org/rfc/rfc9421).
- **C1:** [Cloudflare Verified bots](https://developers.cloudflare.com/bots/concepts/bot/verified-bots/), updated October 8, 2026.
- **C2:** [Cloudflare Web Bot Auth integration](https://developers.cloudflare.com/bots/reference/bot-verification/web-bot-auth/), updated October 8, 2026; older wire profile, Ed25519, registration, no nonce replay enforcement, experimental forwarding.
- **V1:** [Vercel BotID](https://vercel.com/docs/botid), updated June 16, 2026.
- **V2:** [Vercel Handling Verified Bots](https://vercel.com/docs/botid/verified-bots), updated February 26, 2026.
- **V3:** [Vercel bot verification supports Web Bot Auth](https://vercel.com/changelog/vercels-bot-verification-now-supports-web-bot-auth), August 12, 2025.
- **A1:** [OpenAI Cloud browser allowlisting](https://help.openai.com/en/articles/11845367-chatgpt-works-cloud-browser-allowlisting), current page title is “ChatGPT Work's Cloud browser allowlisting.”
- **A2:** [OpenAI crawler/user-agent documentation](https://developers.openai.com/api/docs/bots).
- **A3:** [Anthropic crawler and Claude-User documentation](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler), April 7, 2026.
- **A4:** [Google user-triggered fetchers / Google-Agent](https://developers.google.com/crawling/docs/crawlers-fetchers/google-user-triggered-fetchers), updated August 19, 2026.
- **A5:** [Google experimental Web Bot Auth verification](https://developers.google.com/crawling/docs/crawlers-fetchers/web-bot-auth), updated May 4, 2026.
- **A6:** [OpenAI ChatGPT agent launch](https://openai.com/index/introducing-chatgpt-agent/), July 17, 2025; **explicitly marked outdated**, cited only for historical confirmation UX.
- **R1:** Repo baseline [Turnstile verifier](https://github.com/fillthemat/fillthemat/blob/9004dcc/src/lib/security/turnstile.ts).
- **R2:** Repo baseline [security limits](https://github.com/fillthemat/fillthemat/blob/9004dcc/src/lib/security/limits.ts) and [known gaps](https://github.com/fillthemat/fillthemat/blob/9004dcc/docs/known-gaps.md).
- **R3:** Repo baseline [coding standards](https://github.com/fillthemat/fillthemat/blob/9004dcc/CODING_STANDARDS.md), “The assistant prepares; the platform books.”
