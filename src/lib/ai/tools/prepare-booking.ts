import { type InferToolOutput, tool } from "ai";
import { z } from "zod";
import { isAgeEligible } from "@/lib/schedule/occurrences";
import { parseSlotId } from "@/lib/schedule/slot-id";
import type { AssistantContext } from "../context";
import { trialAvailability } from "./trial-availability";

export function prepareBooking(ctx: AssistantContext) {
  return tool({
    description:
      'Revalidate a trial offering and trial occurrence and return a Booking Intent for the booking confirmation flow. This does not create a booking. Collect the participant name and age first so the platform can book without asking again. Returns ineligible_age when a provided age is outside the offering\'s age range; a missing age is accepted and collected at confirmation. Eligibility is determined only by offering age ranges. Do not override them. Class times come only from tools. Never invent, round, or "hold" a time.',
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
      const parsed = parseSlotId(slotId);
      if (!parsed) {
        return { ok: false as const, reason: "invalid" as const };
      }
      const availability = trialAvailability(ctx, offeringId);
      if (!availability) {
        return { ok: false as const, reason: "invalid" as const };
      }
      const { offering, occurrences } = availability;
      if (participantAge != null && !isAgeEligible(participantAge, offering)) {
        return { ok: false as const, reason: "ineligible_age" as const };
      }
      const slot = occurrences.find((candidate) => candidate.slotId === slotId);
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

type PrepareBookingOutput = InferToolOutput<ReturnType<typeof prepareBooking>>;
type PrepareBookingOk = Extract<PrepareBookingOutput, { ok: true }>;

export type BookingIntent = {
  trialOfferingId: PrepareBookingOk["offering"]["id"];
  slotId: PrepareBookingOk["slot"]["slotId"];
  participantName: PrepareBookingOk["participantName"];
  participantAge: PrepareBookingOk["participantAge"];
};

export function bookingIntentFromResult(
  output: PrepareBookingOutput | undefined,
): BookingIntent | null {
  if (!output?.ok) return null;
  return {
    trialOfferingId: output.offering.id,
    slotId: output.slot.slotId,
    participantName: output.participantName,
    participantAge: output.participantAge,
  };
}
