---
status: accepted
---

# AgentPhone supplies WhatsApp number rental, not WhatsApp messaging

Use AgentPhone rather than Twilio to rent each school's US number and receive Meta's SMS/voice verification codes. We accept higher per-number cost (approximately $3/month instead of $1) and less maturity to partner early with founder support and leave room for future SMS/voice capabilities. Preserve the injected number-provider boundary and the school-owned direct Meta Cloud API integration from ADR-0005; adopting AgentPhone's WhatsApp beta is deferred to a separate spike.

Numbers carry the allocation UUID in AgentPhone's unique `externalId` for reconciliation; uncertain purchases stay claimed for support rather than retrying blindly. Before a pilot, prove that real Meta OTPs arrive by both SMS and voice and the rented number registers on Cloud API. AgentPhone's published API has no transcript/recording deletion endpoint, so vendor retention controls and recording-consent requirements must be confirmed with founder support; do not claim automatic vendor OTP erasure.
