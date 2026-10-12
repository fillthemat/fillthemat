---
status: accepted
---

# An in-repo core boundary, only after the driver-seam proof

The [core map (#204)](https://github.com/fillthemat/fillthemat/issues/204) resolved to [rung 1, conditional (#212)](https://github.com/fillthemat/fillthemat/issues/212): an incremental `src/core/` boundary with a lint rule forbidding core → Fill the Mat and core → Next.js imports. Core may depend on Vercel's AI SDK, Chat SDK, Workflow and AI Gateway. The aim is to make Fill the Mat simpler to change by owning a thin reliability layer, not to create another product.

Core owns canonical Conversation/Turn records, per-Conversation serialisation, outbound intent/retry/receipt mechanics and the Handoff fence; Fill the Mat keeps lifecycle policy and every domain effect. As [#213](https://github.com/fillthemat/fillthemat/issues/213) and [#211](https://github.com/fillthemat/fillthemat/issues/211) resolve, drivers return a reply plus typed prepared results that the app interprets. Core opens one transaction, validates Operator/Conversation scope and control, then calls a bounded, database-only app-effect callback: the Turn, domain effects and outbound intents commit or roll back together. In-repo Drizzle coupling is accepted; the callback's database-only bound is enforced by review and tests, not a sandbox.

The boundary is created only after [the driver-seam proof (#232)](https://github.com/fillthemat/fillthemat/issues/232) passes: the hosted Assistant (an Agent) and a domain-free fake external driver run on existing jobs/outbox through that transaction, passing the same Turn-commit integration tests, including rollback and retry deduplication. Poppy lands first, then its shared seams are re-mapped; no `src/core/` move or Workflow/Chat SDK migration belongs in the proof. If the proof fails, including if Fill the Mat becomes harder rather than simpler to change, revert to rung 0: no extraction.

## Considered Options

- **No extraction (rung 0):** not the chosen destination, but retained as the fallback if the driver seam does not justify the boundary.
- **Workspace package (rung 2) or separate repo/published package/product (rung 3):** shelved; a crowded market does not justify a separate platform product or packaging work for this in-repo effort.
- **Adopt a whole-product alternative:** rejected for this effort; the Chatwoot trial was closed in favour of going deeper on the Vercel stack, not because alternatives were proven insufficient.

Revisit rungs 2–3 only as a fresh effort when a second, non-martial-arts Operator asks to use the core **and** its interface has been stable for a quarter.
