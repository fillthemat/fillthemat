# Core DX sketch — throwaway, not executable

Reaction artifact for [#211](https://github.com/fillthemat/fillthemat/issues/211), under [map #204](https://github.com/fillthemat/fillthemat/issues/204).
No extraction, migrations, dependencies, running app, or settled API added.

## Read the three files

- `agents.ts`: app defines its Assistant as a core Agent, supplies domain tools,
  and normalizes AI SDK results into `{ reply, prepared }`. The fake external
  driver knows no domain. Optional WorkflowAgent run calls the same commit.
- `channels.ts`: three Channel Connections route to that Agent. App authenticates
  identities and supplies lifecycle policy; core retains accepted Turns/dispatch.
  Chat's WhatsApp adapter is transport only; web keeps AI SDK, Poppy stays custom.
- `commit.ts`: conceptual core implementation plus app callback registration.
  Scope/control checks, app writes, validated reply, audit and outbound intents
  share one transaction. Retry receipt skips effects already committed.

All `core.*`, `app.*`, types and bridges are **placeholders**; core's `app` means injected callbacks, not imports.
The database-only callback bound is a contract, not proven sandbox enforcement.
Driver input comes from canonical core records; model/browser IDs confer no scope.
App adapters interpret prepared results; core never learns booking/lead semantics.

## Open DX questions

1. Can a typed prepared-result seam avoid exposing app effects or SDK classes to external drivers?
2. Is a Drizzle callback simple enough, and how do we enforce scope, action bounds and no-network?
3. Can the WhatsApp bridge expose chunks/receipts/unknowns without rebuilding today's sender?
4. Which Poppy issuer/session IDs identify the Counterpart and authorize Conversation reuse?
5. Would Workflow, callback reconstruction and committed-only web output simplify or obscure the API?

## Criterion 5: honest judgement

**Promising, not passed.** Defining an Agent and connecting channels reads simply;
the transactional callback is understandable and matches #213. But helper names
hide unproven transport/stream/typing work. Prove the driver seam on existing jobs
first; this static sketch demonstrates vocabulary and ergonomics, not reliability.

Basis: origin/main `31a2ac7`, root `GLOSSARY-MAP.md`, `docs/core/GLOSSARY.md`, #213's resolution, and [Vercel-native report](https://github.com/fillthemat/fillthemat/blob/research/vercel-native-core/docs/research/vercel-native-core.md).
AI APIs checked against bundled `ai@7.0.128` docs; registry latest `7.0.138`.
No verify/typecheck run (research-only sketch); no lint/typecheck exclusions added.
