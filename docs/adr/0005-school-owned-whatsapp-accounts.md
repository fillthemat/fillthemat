---
status: accepted
---

# Each school owns its WhatsApp Business account

Spec #188 supersedes **D9 (shared WABA)** and decision C in the WhatsApp plan: Meta does not allow different businesses' numbers in one WhatsApp Business account. Each school owns its WABA and grants Fillthemat customer-scoped access through Embedded Signup v4 on direct Cloud API; one Fillthemat Tech Provider app/webhook stays shared, but credentials never fall back to a global system-user token. Fillthemat rents the school's new US number; the school pays Meta directly using its own card, trading an extra owner billing step for account ownership and isolation without a Solution Partner.

The connection is Live only after registration and funding. Reply-only, in-window plain booking confirmations supersede decision G's shared templates; WhatsApp reminders and Assistant-initiated/out-of-window messages stay out. Switch-off cools for 30 days, release invalidates old links/QR codes, and retained conversations stay attributed to the school. Historical queued templates fail closed, with the existing owner follow-up email for non-stale booking confirmations.

WhatsApp conversations, even derived or anonymized, must not train or improve shared models. ADR-0001's tracing and ADR-0002's retention authorize debugging/history, not shared training or dataset export. Provider/Gateway and tracing/export no-training terms/settings require operator verification before the first real school goes Live through this flow; code inspection and masked traces cannot prove an external contractual setting.
