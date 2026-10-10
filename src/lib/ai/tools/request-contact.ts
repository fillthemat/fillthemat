import { type InferToolOutput, tool } from "ai";
import { z } from "zod";
import type { AssistantContext } from "../context";

export function requestContact(_ctx: AssistantContext) {
  return tool({
    description:
      "Gather a Lead Request when someone asks the school to contact them because they cannot or do not want to book a trial now (no matching trial offering, no workable trial occurrence, or an explicit 'contact me'). The platform asks for their consent before passing the request to the school. Collect name, age, and need first.",
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

type RequestContactOutput = InferToolOutput<ReturnType<typeof requestContact>>;

export type LeadRequest = {
  participantName: RequestContactOutput["participantName"];
  participantAge: RequestContactOutput["participantAge"];
  trialOfferingId: RequestContactOutput["offeringId"];
  statedNeed: RequestContactOutput["statedNeed"];
};

export function leadRequestFromResult(
  output: RequestContactOutput | undefined,
): LeadRequest | null {
  if (!output) return null;
  return {
    participantName: output.participantName,
    participantAge: output.participantAge,
    trialOfferingId: output.offeringId,
    statedNeed: output.statedNeed,
  };
}
