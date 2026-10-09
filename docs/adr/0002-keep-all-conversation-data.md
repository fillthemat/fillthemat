---
status: accepted
---

# Keep all conversation data; no retention policy for now

Conversations are never deleted: one that ends (after 30 days without a new message, or at its message limit) is kept in a terminal state, and the next message starts a new conversation. Transcripts are kept too, so there is no data retention policy. This replaces the 30-day transcript purge in `docs/archive/v1-architecture.md`. At our stage, learning from real usage is worth more than minimising what we hold, and an audit trail is easier to reason about when nothing disappears. A stricter retention policy and a deletion process can be added later; nothing here prevents them.

The same applies to Langfuse traces (ADR-0001): they are kept as long as the plan allows. The one exception is an explicit request from a person or school to delete their data, which an operator handles manually until a deletion process exists.

## Consequences

- Maintenance stops deleting conversations and purging message content. It only marks inactive conversations as ended. The purge plumbing (`messages.purge_at`, `purgeExpiredTranscripts`) is removed rather than left unenforced.
- A person can have many ended conversations per channel identity, but at most one active one.
- No user-facing copy may promise that transcripts are deleted. ADR-0001's note about "Supabase transcript purging" no longer applies.
