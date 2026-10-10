---
status: accepted
---

# School facts stay in the assistant's instructions; live data comes from tools

The assistant's instructions carry the school's profile (name, location, contact details, parking and access notes, trial guidance, pricing, welcome message), its FAQs, and its owner instructions. Trial offerings and trial occurrences come only from tools. We considered serving FAQs and profile facts through a lookup tool to shrink the instructions, and rejected it: the facts are static per school, so the instructions are a cacheable prefix and cost little to repeat, while a lookup tool only helps when the model chooses to call it, and when it doesn't it guesses, which breaks "never invent school facts". Each lookup would also spend an agent step and add latency. Revisit if a school's FAQs grow large enough to matter.

The same decision sets where every assistant rule lives:

1. A rule that code can enforce is enforced in the tool's execution or the platform, not stated as an instruction.
2. A rule that only matters when one tool is used lives in that tool's description.
3. The instructions keep only what applies on every turn regardless of tools: identity, honesty, privacy, payment and waiver limits, the untrusted-data rule, and what owner instructions may change.

## Consequences

- Tool descriptions and input schemas are platform-authored behaviour, so the reply provenance hash covers them alongside the platform instructions.
- Adding a capability means adding a tool, not adding instructions.
