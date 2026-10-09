---
status: accepted
---

# Trace every production turn in Langfuse

Every production turn on every channel is traced to Langfuse, one trace per turn and one Langfuse session per conversation, tagged with school and channel, with obvious contact fields masked before export. This supersedes the opt-in, operator-only, synthetic-data capture policy in `docs/conversation-debugger-plan.md` ("Privacy and authorization contract"): at our stage, real-traffic debugging is worth more than the gate's machinery, and AI SDK 7 traces by default once registered anyway. Consequence: prospect messages (including participant ages) leave our infrastructure, so the privacy policy must disclose Langfuse as a processor, and Supabase transcript purging does not delete Langfuse data.
