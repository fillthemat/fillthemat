import { tool } from "ai";
import { z } from "zod";
import type { AssistantContext } from "../context";
import { trialAvailability } from "./trial-availability";

export function listTrialOccurrences(ctx: AssistantContext) {
  return tool({
    description:
      'List currently open trial occurrences for one trial offering. Class times come only from tools. Never invent, round, or "hold" a time.',
    inputSchema: z.object({
      offeringId: z.string().uuid(),
    }),
    execute: async ({ offeringId }) => {
      const availability = trialAvailability(ctx, offeringId);
      if (!availability) {
        return { slots: [], noMatch: true, reason: "unknown_offering" };
      }
      const slots = availability.occurrences;
      return {
        slots: slots.map((slot) => ({
          slotId: slot.slotId,
          localDateLabel: slot.localDateLabel,
          localTimeLabel: slot.localTimeLabel,
          remaining: slot.remaining,
          timezone: slot.timezone,
        })),
        noMatch: slots.length === 0,
      };
    },
  });
}
