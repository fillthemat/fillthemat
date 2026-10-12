# Multi-tenant Poppy hosting options for a platform

Research date: **2026-10-11**. Resolves [#124](https://github.com/fillthemat/fillthemat/issues/124), part of [#122](https://github.com/fillthemat/fillthemat/issues/122). This is an options-and-constraints report, **not a hosting or authorization decision**; that belongs to [#125](https://github.com/fillthemat/fillthemat/issues/125).

## Findings at a glance

- One shared deployment can host many Schools as separate Poppy Companies. Each School needs a distinct issuer, not necessarily a distinct server or issuer hostname. Reusing one issuer for all Schools makes them **one Company** under Poppy. [P1, R1]
- Either a per-School platform subdomain or a School-owned domain redirecting its well-known discovery URL to the platform works. Redirected JSON must identify the **original requested School host**, not the platform serving the JSON. Existing `/s/[slug]` pages alone cannot provide host-based, per-School discovery. [P1]
- Supabase's documented OAuth server is not a drop-in Poppy token endpoint: its grants, client authentication methods, Bearer tokens, and session semantics do not cover the required signed-out flow. Retaining Supabase for owner sign-in is independent of choosing a Poppy authorization server. [S1, S2, C1]
- `oidc-provider` supplies an authorization-server foundation, `private_key_jwt`, experimental URL-client metadata, and DPoP, but needs a custom JWT-bearer grant and Poppy session/tenant policy. `jose` supplies crypto, and `oauth4webapi` primarily supplies client operations; neither is a Poppy server. [L1–L5]
- Vercel/Next.js can route discovery and School endpoints by verified host or stable issuer path. Durable, atomic replay rejection and tenant binding are application responsibilities; process-local state is insufficient. [N1–N3, V1, L2, R2]

## 1. Identity and discovery requirements

Poppy Draft 0.1, updated October 9, 2026, is explicitly unstable. The following requirements come from §§3–4, not from generic OAuth assumptions. [P1]

1. A Company publishes `https://{domain}/.well-known/poppy.json` over HTTPS; `{domain}` can be its domain or a subdomain it controls. Agents follow redirects, and every redirect must use HTTPS.
2. `organization.domain` matches the host the Agent **originally requested**, ignoring a leading `www.`. Redirects do not change the represented Company domain.
3. `auth.issuer` identifies the Company. Several domains naming one issuer are one Company: they share User IDs, Sessions, and Account Tokens. For one Company per School, issuers must differ.
4. The issuer publishes RFC 8414 authorization-server metadata. Its `issuer` must exactly equal `auth.issuer`; its `poppy_domains` must include every domain whose discovery document names that issuer. Agents must check both before using discovery.
5. Metadata needs `token_endpoint` and `revocation_endpoint`, even though sign-in can be omitted. Authorization and device endpoints are required only when their sign-in modes are advertised. A Company can offer **only signed-out Sessions** by omitting `auth.direct`, `auth.device`, and `auth.mediated`—not by omitting `auth` from a conversational service. [P1]

### Issuer shapes on shared infrastructure

These are illustrative URLs, not provisioned domains or selected designs:

| Shape | School issuer | RFC 8414 metadata URL | Trade-off |
| --- | --- | --- | --- |
| Per-School auth host | `https://alpha.schools.fillthemat.com` | `https://alpha.schools.fillthemat.com/.well-known/oauth-authorization-server` | Simple host-based identity; issuer continuity tied to hostname lifecycle |
| Stable path on shared auth host | `https://auth.fillthemat.com/schools/school_123` | `https://auth.fillthemat.com/.well-known/oauth-authorization-server/schools/school_123` | Fewer auth-domain operations; explicit path routing and tenant separation |
| School-owned auth host | `https://auth.alpha-school.example` | `https://auth.alpha-school.example/.well-known/oauth-authorization-server` | School-controlled identity; additional DNS/TLS setup and transfer responsibilities |

RFC 8414 §3 inserts `/.well-known/oauth-authorization-server` **between the host and the issuer path**. Do not construct the path-issuer metadata URL by appending that suffix to the issuer; OIDC discovery has a different path convention. RFC 8414 permits HTTPS issuer paths, but not query strings or fragments. [R1]

For the stable-path option, minimal metadata could look like:

```json
{
  "issuer": "https://auth.fillthemat.com/schools/school_123",
  "token_endpoint": "https://auth.fillthemat.com/schools/school_123/oauth/token",
  "revocation_endpoint": "https://auth.fillthemat.com/schools/school_123/oauth/revoke",
  "poppy_domains": ["alpha.schools.fillthemat.com", "alpha-school.example"]
}
```

A second School must have a different issuer and its own domain list. Using different token endpoint paths makes the Poppy Session assertion's required single-string `aud` distinguish Schools; a shared endpoint would instead need another unambiguous, validated tenant discriminator. Prefer immutable School identity in an issuer path over a mutable marketing slug: changing an issuer changes the Company identity and the Agent's per-Company User ID context. These are design implications, not additional protocol requirements. [P1, R1]

## 2. Discovery hosting alternatives

| Option | Discovery flow | Benefits | Costs and constraints |
| --- | --- | --- | --- |
| Platform subdomain per School | `alpha.schools.fillthemat.com/.well-known/poppy.json` → School JSON | Platform controls onboarding, DNS, TLS, and availability; no School website changes | Agents must discover/use this School subdomain; wildcard setup and host registry; subdomain/cookie isolation |
| School-owned domain, discovery-only redirect | `alpha-school.example/.well-known/poppy.json` → HTTPS platform URL such as `fillthemat.com/poppy/discovery/school_123/alpha-school.example` | Keeps existing website hosting and ordinary DNS; discovery appears on the School's established domain | School must configure an exact-path HTTPS redirect or proxy on its current host; platform must verify domain control and serve original-host-specific JSON; two operators affect discovery availability |
| School-owned domain fully hosted on Vercel | School domain assigned to platform project; well-known JSON served directly | Platform controls routing and optional browser-session integration on that domain | DNS cutover, ownership verification, certificates, website migration, and removal/transfer lifecycle |

The discovery-only redirect is specifically allowed by Poppy §3. Its destination can use an ordinary platform path: the **original** well-known URL satisfies the discovery requirement. The returned document must have `organization.domain: "alpha-school.example"`; `poppy_domains` must list that same domain. A platform-subdomain discovery request needs JSON naming the platform subdomain instead. Do not redirect both entry points to one hard-coded document naming only one host. [P1]

Serving the redirect destination does not require adding `alpha-school.example` to Vercel: the School's existing HTTPS server handles the redirect. It does require that server/CDN/CMS to support this well-known path. A redirect at the apex landing page is not a substitute. If the School cannot configure the path, full custom-domain hosting or the platform subdomain remains an alternative. [P1; operational implication]

Both domains can represent the **same School** with one stable issuer and both names in its `poppy_domains`. That supports domain migration without merging different Schools. Domain onboarding should establish control, bind one domain to one School, and maintain redirects/discovery/metadata together. Removing or reassigning a domain needs cache invalidation and a takeover policy; use HTTP cache lifetimes that bound stale domain authorization. [P1; security implications]

**Boundary:** a discovery redirect does not make the existing School website part of a Poppy browser Session. That optional feature needs a browser-session endpoint, assertion verification, and a cookie integrated with the website's current Session state. It can be omitted while platform conversations/APIs use Session Tokens. [P1 §5]

## 3. What the token endpoint actually needs

There are **two different signed JWTs**, plus a DPoP proof, on a normal signed-out token request. Supporting JWT client authentication alone does not implement the JWT-bearer grant. [P1 §§4.1–4.3, R3]

| Input or behavior | Required Poppy semantics |
| --- | --- |
| Agent identity | HTTPS URL `client_id` returning its Client ID Metadata Document; document `client_id` equals fetched URL; HTTPS `jwks_uri` and redirect URIs on the same domain; optional registration/allowlist policy |
| Client authentication | `client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer` and `client_assertion`, verified using the Agent's published keys (`private_key_jwt`) |
| Session creation grant | `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`; independently verify `assertion` against Agent keys, `iss` equals authenticated `client_id`, opaque per-Company User ID in `sub`, single-string `aud` equals this School's token endpoint, short lifetime, fresh `jti` with at least 128 random bits |
| Replay | Reject reused Session assertion IDs; separately protect client assertions and DPoP proofs against replay |
| Renewal | Accept `session_id`; check active Session belongs to same School, Agent, and User ID; otherwise `invalid_session`; signed-in renewal uses the Account Token, not the signed-out assertion |
| Response | Short-lived access token, positive `expires_in`, `token_type: "DPoP"`, empty signed-out account `scope`, `session_id`, `signed_in: false`, and `Cache-Control: no-store` |
| Resource requests | DPoP proof and `Authorization: DPoP`; enforce key binding, method/external URI, time/replay, and access-token hash (`ath`); no cookie required |

The Agent's stable User ID is scoped by Company issuer, not an email hash or a platform-wide prospect identifier. Store/resolve it with at least `(school/issuer, client_id, user_id)`. `session_id` is not a credential and must never authorize access on its own. Session Tokens are opaque to Agents; if they embed existing Session credentials, Poppy requires encryption. Opaque random tokens with server-side state are also possible. [P1 §4.2]

DPoP keys are separate from the Agent's published assertion keys. The narrow exception is MCP: issue a Bearer token without a proof only with the MCP server URL as `resource`, and accept it only at that MCP server. Conversations/OpenAPI must still require DPoP. Do not relax DPoP globally just because MCP or Supabase uses Bearer tokens. [P1 §4.3]

If prospect account sign-in is later introduced, authorization-code/device/refresh flows also need Poppy Session binding, account mismatch protection, response fields, and revocation that signs out linked Sessions. The OAuth provider's browser login session or an ordinary refresh-token family is not automatically a Poppy Session. None of these optional sign-in modes is needed for a signed-out-only first slice. [P1 §§4.4–4.9]

## 4. Authorization implementation options

### Capability matrix

“Custom” means application work, not a feature enabled by naming the library.

| Requirement | Supabase OAuth server, documented | `oidc-provider`, inspected source | Custom Web handlers with JOSE helpers |
| --- | --- | --- | --- |
| Many distinct School issuers on one backend | Project issuer documented; no per-School issuer facility established | Provider constructed with issuer; tenant-specific instances/configuration possible | Custom issuer registry and routing |
| URL `client_id` metadata | Registration-generated IDs and dynamic registration documented, not CIMD | Experimental `features.clientIdMetadataDocument`, draft-02 | Custom fetch/validation/cache/policy |
| `private_key_jwt` | Documented methods: `none`, `client_secret_basic`, `client_secret_post` | Built in | JOSE verification plus OAuth policy |
| RFC 7523 JWT-bearer grant | Only authorization-code and refresh grants documented | Custom grant via `registerGrantType` | Entire grant implementation |
| Poppy `session_id` and response/state semantics | Supabase JWT `session_id` is not this protocol extension | Custom Poppy state and grant integration | Custom Poppy state |
| DPoP issuance/replay | Documented response is always Bearer | DPoP feature; custom grant must invoke validation, binding, replay helpers | Custom proof validation, binding, replay |
| RFC 8414 plus `poppy_domains` | Discovery exists; no documented Poppy/per-School customization | Discovery extensions and mount routing | Custom metadata handlers |
| Next App Router fit | Hosted service, not an embedded handler | Node/Koa request/response callback; integration needed | Native Web Request/Response |

Sources: [S1, S2, L1–L5, N1]. This is a documented-capability comparison, not a live compatibility certification.

### A. Supabase for owner auth; separate Poppy server

The hosted OAuth server is documented as beta. Its two supported grants do not include the signed-out JWT-bearer grant; its client authentication methods do not include `private_key_jwt`; its access-token `token_type` is always `bearer`; custom OAuth scopes are not currently supported. Dynamic client registration is not URL-client metadata resolution. An access-token hook cannot by itself create a new grant, implement DPoP verification, or create School-specific issuers. [S1, S2]

These are independent blockers, so enabling the repo's disabled `[auth.oauth_server]` is not enough. A separate Poppy server can leave current owner Google/Supabase auth intact and use existing database infrastructure for its own state. A Supabase anonymous user is likewise not the Agent-signed assertion flow. Poppy tokens must not be mistaken for owner Supabase tokens or grant dashboard authority. [C1, P1, S1]

Supabase documentation has differing discovery-path examples: the flows page appends the suffix, while getting-started uses the RFC 8414 host-prefix path. Follow RFC 8414 for our path issuers and verify actual deployed behavior rather than treating the examples as interchangeable routing rules. No hosted Supabase configuration or live server was changed or probed here. [S1, S2, R1]

### B. `oidc-provider` as the shared authorization-server foundation

Inspected source is pinned to commit `547b2bf12eb564b2f9ab80b344bcddf11ea00fa4` (October 1, 2026); its package declares version **9.12.2**. This establishes source behavior, not that a particular npm artifact was tested. [L1]

It supplies `private_key_jwt`, configurable discovery, persisted-model adapters, DPoP (enabled by default, `allowReplay: false`), and experimental CIMD support. Production requires an external storage adapter; its default memory adapter is development-only. A separate Provider/configuration per issuer can share one process/service and physical database, provided adapters and tenant models are namespaced by issuer. Do not mutate a global Provider's issuer on each request. [L1, L2; implementation implication]

Remaining work:

- Register the JWT-bearer grant and explicitly register parameters such as `assertion`, `session_id`, `resource`, and `scope`. The library authenticates clients before dispatching the handler, but the handler owns assertion trust, audience, subject mapping, replay, authorization, issuance, and response. [L1]
- Configure URL-client grant permissions: resolving metadata does not automatically allow a new client to use our custom grant. Enforce Poppy's same-domain JWKS/redirect rules and Agent registration policy. Preserve necessary Poppy extension metadata; do not equate generic draft CIMD support with full Poppy conformance. [P1, L1]
- Build signed-out Poppy Sessions without turning the opaque prospect identity into a signed-in owner account. Bind token state to School, Agent, User ID, Session, and DPoP key; return `session_id`/`signed_in`; enforce the MCP exception per resource. [P1]
- Preserve both `validateDpop` **and** `checkDpopReplay`, set token `jkt` binding, and enforce proof-required policy for non-MCP token requests. Merely enabling DPoP permits proof-less requests in some configurations. Helpers under `oidc-provider/lib/helpers/grants.js` are explicitly **not semver-stable**: pin an exact version and review changes on upgrades. [L1, L3]
- Ensure atomic replay protection. At the inspected revision, `ReplayDetection.unique` does `find` followed by `save`. Two simultaneous requests can both miss. A shared adapter with ordinary upsert is not sufficient; storage/integration must atomically reject a duplicate and map it to the appropriate OAuth failure. This applies to the library's client-assertion and DPoP replay paths as well as our independent Session assertions. [L2, L3, L6]
- Verify optional code/refresh/device flows against Poppy's Session model before advertising them. Provider OIDC Sessions are not a substitute. [P1, L1]

The library mounts through a Node/Koa callback using Node request/response objects. A Next.js App Router handler uses Web Request/Response; these are not interchangeable. Options are a separately deployed Node auth service behind the advertised public URLs, a compatible Node function/service mount, or a deliberately tested bridge. This report does **not** establish a drop-in Next/Vercel adapter or Bun compatibility for this provider. [L1, N1]

### C. Narrow custom Poppy handlers using crypto libraries

For signed-out-only Sessions, native Next Web handlers plus `jose` can implement just the advertised grant and metadata. `jose` covers JWT/JWK validation, thumbprints, and encryption, not client registry policy, OAuth error handling, Sessions, token lifecycle, or atomic replay storage. This gives a direct App Router fit and a small protocol surface, but the platform owns security-sensitive OAuth/DPoP behavior and future sign-in flows. [L5, P1, N1]

`oauth4webapi` is primarily a low-level **OAuth client** library, not an authorization server. Its `validateJwtAccessToken` resource-server helper validates RFC 9068 JWT access tokens and DPoP-related resource requests, but application scope/identity/nonce policy and replay protection still need attention. It is not a general validator for opaque or encrypted Poppy tokens. Use it for compatible resource-server checks or a test Agent, not as evidence that token issuance is implemented. [L4]

**Trade-off:** the provider option reuses more OAuth machinery but needs deployment integration and Poppy customizations. The narrow custom option fits Next directly but owns more protocol/security code. Supabase can remain the owner identity provider in either. Selection, optional sign-in scope, and a compatibility spike belong to #125.

## 5. DPoP and replay operations on Vercel

At token issuance and every protected API/conversation request, validate the proof signature, `typ: dpop+jwt`, permitted asymmetric algorithm and public JWK, `htm`, external HTTPS `htu` (excluding query/fragment), freshness, nonce if required, and unused `jti`. Resource requests additionally need `ath` and a proof key matching the token's binding. Reject tokens from another School even if the endpoint implementation and signing infrastructure are shared. [R2 §4.3, P1 §4.3]

Operational requirements derived from those checks:

- Use a **shared atomic TTL store** across instances/regions for accepted proof IDs and assertion IDs. A bounded, collision-resistant encoding/hash of purpose, issuer/tenant, authenticated client or key context, and `jti` avoids unbounded attacker-provided keys and cross-purpose collisions. Insert-if-absent must decide acceptance; a prior read does not.
- Retain Session/client assertion replay records through their full permitted expiry including clock tolerance. Retain proof IDs until the proof cannot pass any accepted time/nonce window. A short freshness window bounds storage; nonces mitigate pre-generated proofs but do not eliminate replay rejection. [R2 §11.1, P1, L2]
- Redis atomic conditional insertion with expiry or a database uniqueness-enforced operation are possible implementation families. Storage failure must fail closed; do not fall back to in-process replay memory. No database schema or Redis dependency is selected in this research.
- Keep Sessions/token state durable too. Serverless warm-process caches may accelerate reads but cannot be the source of truth for authorization or revocation.
- Reconstruct the **public** endpoint URL only through trusted proxy configuration and a validated host registry. An internal rewrite URL must not become the expected `htu` or assertion audience. Do not trust arbitrary forwarded host headers. [L1 proxy mounting, L3, R2]
- Fetch Agent metadata/JWKS with HTTPS and same-domain checks, bounded time/size, controlled redirects, and SSRF defenses against private/link-local destinations, including DNS changes. Cache by full client URL and handle key rotation. Rate-limit new clients and Session creation to bound fetch/storage abuse. [P1 §4.1; security implications]

Before production, test simultaneous replays on separate instances, wrong-School tokens/Sessions/assertions, altered public URLs, proof-less requests, stale proofs, key rotation, cache isolation, and storage outages. These are acceptance checks to run in an implementation spike, not tests completed by this research.

## 6. Vercel and Next.js routing changes

### Domain infrastructure

Vercel supports wildcard and custom domains on a shared project. Wildcard certificates require access to DNS challenges: the documented route uses Vercel nameservers; current docs also describe external-DNS certificate-validation delegation. A wildcard covers only one label level (`*.schools.fillthemat.com` covers `alpha.schools.fillthemat.com`, not `auth.alpha.schools.fillthemat.com`). [V1]

Full custom-domain hosting needs assignment, DNS configuration/control verification, certificate readiness, and removal/transfer handling. The project-domain API can return `verified: false` with verification challenges; adding a domain is not proof it is ready or belongs to the School. A discovery-only redirect leaves that lifecycle on the School's existing host and needs only the platform destination to be available. [V1, V2]

### Repo changes needed, without implementing them here

At baseline commit `7aa55ed`, Schools are selected by `/s/[slug]`; `publicSchoolPath` constructs that path on a single configured site origin. `next.config.ts` has no tenant rewrites. `src/proxy.ts` refreshes Supabase owner cookies via `getClaims()` and its broad matcher includes well-known JSON. The local OAuth server is disabled. These are repository observations, not evidence of live production domain configuration. [C1]

Possible layout:

| Public request | Resolution |
| --- | --- |
| School host `/.well-known/poppy.json` | Validated host → School/domain → discovery response |
| Shared host `/poppy/discovery/{schoolId}/{domain}` | Explicit verified School/domain pair → original-domain discovery response |
| Auth host `/.well-known/oauth-authorization-server/schools/{schoolId}` | School issuer registry → RFC 8414 metadata |
| Auth host `/schools/{schoolId}/oauth/token` or `/oauth/revoke` beneath that School prefix | Same issuer registry → tenant-bound Poppy auth implementation |
| School host page/conversation/API | Validated host and/or endpoint path → School; authenticate token and independently check matching School |

Next.js 16 uses `proxy.ts`, replacing middleware; Proxy runs in the Node.js runtime and can rewrite requests. Static host-based rules are also possible with `next.config.ts` rewrites using `has: [{ type: "host", ... }]`. A runtime domain registry is useful for dynamically onboarded domains; keep expensive auth/database work in handlers/library code, not in Proxy. [N2, N3]

Native discovery/token Route Handlers use Web Request/Response; handlers are not cached by default. Explicit discovery/metadata caching is fine only when keyed by School **and represented domain/issuer**, with bounded lifetimes and invalidation on domain changes. Token/revocation responses must not enter public caches. Host resolution should reject unknown hosts rather than fall back to a School. Handle well-known endpoints without owner-login redirects or unnecessary owner-cookie refresh and preserve response headers through rewrites. [N1, P1; implementation implications]

Keep existing published/approved School visibility checks when exposing a new host route; do not accidentally expose owner previews. Owner dashboard cookies and Poppy prospect credentials must remain separate. Host-only cookies and CSRF protections matter for tenant subdomains; sibling subdomains are not automatically separate browser sites. Vercel documents `__Host-` cookies and Public Suffix List considerations if tenants can publish untrusted content. [C1, V1]

## 7. Inputs for #125, not a recommendation

The next decision should choose independently:

1. **Discovery identity:** platform subdomain, School-owned redirect, full custom-domain hosting, or both domains for one School.
2. **Stable issuer shape:** School auth host versus immutable School path on shared auth host; migration and ownership/transfer policy.
3. **Server foundation/deployment:** provider-based Node service versus narrow custom Web handlers; prove DPoP and atomic replay behavior in the actual runtime.
4. **First-slice surface:** signed-out conversations/APIs only versus prospect account sign-in and browser integration; advertise only implemented capabilities.

No dependency, domain, deployment, auth configuration, or schema has been changed. There was no running-app or end-to-end interoperability test. Primary-source requirements and implementation constraints above are sufficient to compare options, not to certify a deployment.

## Sources and reproducibility

Live documentation was read for this research; it is not an archived historical snapshot. Poppy displays its October 9, 2026 update, and provider source is pinned before the research date. Vercel's domain-management page displays September 16, 2026; the live REST reference fetched displays October 12, 2026, **after** the requested research date, so its detailed endpoint contract must be rechecked rather than treated as independently verified historical availability. Unpinned library docs are supporting live references, not release-date evidence.

- **P1:** [Poppy Draft 0.1 specification](https://personalagentprotocol.org/docs/spec), §§3–5, updated October 9, 2026.
- **R1:** [RFC 8414](https://www.rfc-editor.org/rfc/rfc8414.html), §§2–3.3: issuer constraints, well-known path placement, issuer validation.
- **R2:** [RFC 9449](https://www.rfc-editor.org/rfc/rfc9449.html), §§4.3, 7, 8–9, 11.1: DPoP validation, binding, nonce, replay considerations.
- **R3:** [RFC 7523](https://www.rfc-editor.org/rfc/rfc7523.html), §§2.1–3.2: distinct JWT authorization grant and client authentication.
- **S1:** [Supabase OAuth flows](https://supabase.com/docs/guides/auth/oauth-server/oauth-flows.md): supported grants, auth methods, token type, scopes, project issuer and Session claims.
- **S2:** [Supabase OAuth server getting started](https://supabase.com/docs/guides/auth/oauth-server/getting-started.md): beta status, registration and authentication methods, RFC 8414 path example.
- **L1:** [`oidc-provider` documentation at inspected commit](https://github.com/panva/node-oidc-provider/blob/547b2bf12eb564b2f9ab80b344bcddf11ea00fa4/docs/README.md): custom grants, mounting, adapter, CIMD, DPoP, discovery; [package declaration](https://github.com/panva/node-oidc-provider/blob/547b2bf12eb564b2f9ab80b344bcddf11ea00fa4/package.json).
- **L2:** [`ReplayDetection.unique` source](https://github.com/panva/node-oidc-provider/blob/547b2bf12eb564b2f9ab80b344bcddf11ea00fa4/lib/models/replay_detection.js): non-atomic read then save.
- **L3:** [DPoP validation/replay source](https://github.com/panva/node-oidc-provider/blob/547b2bf12eb564b2f9ab80b344bcddf11ea00fa4/lib/helpers/validate_dpop.js) and [custom grant helpers](https://github.com/panva/node-oidc-provider/blob/547b2bf12eb564b2f9ab80b344bcddf11ea00fa4/lib/helpers/grants.js).
- **L4:** [`oauth4webapi` README](https://github.com/panva/oauth4webapi/blob/main/README.md) and [`validateJwtAccessToken` reference](https://github.com/panva/oauth4webapi/blob/main/docs/functions/validateJwtAccessToken.md).
- **L5:** [`jose` README](https://github.com/panva/jose/blob/main/README.md): JOSE/crypto capabilities and Web-compatible runtimes.
- **L6:** [JWT client-auth validation source](https://github.com/panva/node-oidc-provider/blob/547b2bf12eb564b2f9ab80b344bcddf11ea00fa4/lib/shared/jwt_client_auth.js): claim/audience verification and replay call.
- **V1:** [Vercel multi-tenant domain management](https://vercel.com/docs/platforms/multi-tenant-platforms/configuring-domains): wildcard DNS/TLS, domain verification, cookies, custom-domain lifecycle.
- **V2:** [Vercel add-project-domain API](https://vercel.com/docs/rest-api/reference/endpoints/projects/add-a-domain-to-a-project) and [verify-project-domain API](https://vercel.com/docs/rest-api/reference/endpoints/projects/verify-project-domain): live contract, with timing caveat above.
- **N1:** Installed Next.js **16.3.3** guide `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`; [public Route Handlers guide](https://nextjs.org/docs/app/getting-started/route-handlers).
- **N2:** Installed `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`; [public Proxy reference](https://nextjs.org/docs/app/api-reference/file-conventions/proxy).
- **N3:** Installed `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/rewrites.md`; [public rewrites reference](https://nextjs.org/docs/app/api-reference/config/next-config-js/rewrites).
- **C1:** Repo baseline `7aa55ed`: [School page](../../src/app/s/[slug]/page.tsx), [site URL helpers](../../src/lib/site-url.ts), [Proxy](../../src/proxy.ts), [owner auth](../../src/lib/auth/current-user.ts), [current School](../../src/lib/auth/current-school.ts), [Supabase config](../../supabase/config.toml), [Next config](../../next.config.ts), [Vercel config](../../vercel.ts), and [current deployment guide](../v1-deploy-current.md).
