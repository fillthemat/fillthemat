import { tool } from "ai";
import { z } from "zod";
import { isAgeEligible, listOpenSlots } from "@/lib/schedule/occurrences";
import { parseSlotId } from "@/lib/schedule/slot-id";
import type { AssistantContext } from "../context";

export function prepareBooking({
  school,
  catalog: { offerings, windows, occurrences },
  now,
}: AssistantContext) {
  return tool({
    description:
      "Revalidate an offering and slot and return data for the booking confirmation flow. This does not create a booking. Collect the participant name and age first so the platform can book without asking again. Returns ineligible_age when a provided age is outside the offering's age range; a missing age is accepted and collected at confirmation.",
    inputSchema: z.object({
      offeringId: z.string().uuid(),
      slotId: z.string().min(1),
      participantName: z.string().trim().min(1).max(80).optional(),
      participantAge: z.number().int().min(0).max(99).optional(),
    }),
    execute: async ({
      offeringId,
      slotId,
      participantName,
      participantAge,
    }) => {
      const offering = offerings.find(
        (row) => row.id === offeringId && row.active,
      );
      const parsed = parseSlotId(slotId);
      if (!offering || !parsed) {
        return { ok: false as const, reason: "invalid" as const };
      }
      if (participantAge != null && !isAgeEligible(participantAge, offering)) {
        return { ok: false as const, reason: "ineligible_age" as const };
      }
      const slots = listOpenSlots({
        offeringId,
        timezone: school.timezone,
        windows,
        occurrences,
        now,
      });
      const slot = slots.find((candidate) => candidate.slotId === slotId);
      if (!slot) {
        return { ok: false as const, reason: "slot_unavailable" as const };
      }
      return {
        ok: true as const,
        offering: {
          id: offering.id,
          name: offering.name,
        },
        slot: {
          slotId: slot.slotId,
          localDateLabel: slot.localDateLabel,
          localTimeLabel: slot.localTimeLabel,
          timezone: slot.timezone,
        },
        participantName: participantName ?? null,
        participantAge: participantAge ?? null,
      };
    },
  });
}
