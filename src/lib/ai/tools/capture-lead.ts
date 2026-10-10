import { tool } from "ai";
import { z } from "zod";
import type { AssistantContext } from "../context";

export function captureLead(_ctx: AssistantContext) {
  return tool({
    description:
      "Record a prospect's request to be contacted when they cannot or do not want to book a trial now (no matching offering, no workable slot, or an explicit 'contact me'). This does NOT create a lead; the platform writes it after the prospect consents. Collect name, age, and need first.",
    inputSchema: z.object({
      participantName: z.string().trim().min(1).max(80).optional(),
      participantAge: z.number().int().min(0).max(99).optional(),
      offeringId: z.string().uuid().optional(),
      statedNeed: z.string().trim().max(1000).optional(),
    }),
    execute: async (input) => ({
      ok: true as const,
      participantName: input.participantName ?? null,
      participantAge: input.participantAge ?? null,
      offeringId: input.offeringId ?? null,
      statedNeed: input.statedNeed ?? null,
    }),
  });
}
