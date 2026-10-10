import { tool } from "ai";
import { z } from "zod";
import { listOpenSlots } from "@/lib/schedule/occurrences";
import type { AssistantContext } from "../context";

export function listTrialSlots({
  school,
  catalog: { offerings, windows, occurrences },
  now,
}: AssistantContext) {
  return tool({
    description:
      'List currently open trial slots for one offering. Class times come only from tools. Never invent, round, or "hold" a time.',
    inputSchema: z.object({
      offeringId: z.string().uuid(),
    }),
    execute: async ({ offeringId }) => {
      const offering = offerings.find(
        (row) => row.id === offeringId && row.active,
      );
      if (!offering) {
        return { slots: [], noMatch: true, reason: "unknown_offering" };
      }
      const slots = listOpenSlots({
        offeringId,
        timezone: school.timezone,
        windows,
        occurrences,
        now,
      });
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
