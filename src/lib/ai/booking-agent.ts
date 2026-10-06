import {
  gateway,
  isStepCount,
  type LanguageModel,
  type Telemetry,
  ToolLoopAgent,
  tool,
} from "ai";
import { z } from "zod";
import type { School, TrialOffering, TrialWindow } from "@/db/schema";
import {
  isAgeEligible,
  listOpenSlots,
  type SlotOccurrence,
} from "@/lib/schedule/occurrences";
import { parseSlotId } from "@/lib/schedule/slot-id";
import { MAX_AGENT_STEPS } from "@/lib/security/limits";
import { buildBookingAgentInstructions } from "./system-prompt";

export const BOOKING_AGENT_MODEL =
  process.env.BOOKING_AGENT_MODEL || "anthropic/claude-sonnet-4.6";

export type BookingTraceState = {
  integration: Telemetry;
  stepCount: number;
  stepLimitTriggered: boolean;
  generationOutcome: "pending" | "complete" | "aborted" | "failed";
  finishReason?: string;
};

export function createBookingAgent({
  school,
  offerings,
  windows,
  occurrences,
  faqs,
  now,
  trace,
  model = gateway(BOOKING_AGENT_MODEL),
}: {
  school: School;
  offerings: TrialOffering[];
  windows: TrialWindow[];
  occurrences: SlotOccurrence[];
  faqs: Array<{ question: string; answer: string }>;
  now: Date;
  trace?: BookingTraceState;
  model?: LanguageModel;
}) {
  const stepCap = isStepCount(MAX_AGENT_STEPS);
  return new ToolLoopAgent({
    telemetry: trace
      ? {
          functionId: "booking-agent",
          integrations: [
            trace.integration,
            {
              onAbort: () => {
                trace.generationOutcome = "aborted";
              },
              onError: () => {
                trace.generationOutcome = "failed";
              },
            },
          ],
        }
      : { isEnabled: false },
    onStepEnd: trace
      ? () => {
          trace.stepCount += 1;
        }
      : undefined,
    onEnd: trace
      ? ({ finishReason }) => {
          trace.generationOutcome = "complete";
          trace.finishReason = finishReason;
        }
      : undefined,
    model,
    instructions: buildBookingAgentInstructions({
      name: school.name,
      timezone: school.timezone,
      city: school.city,
      address: school.address,
      phone: school.phone,
      website: school.website,
      parkingNotes: school.parkingNotes,
      accessNotes: school.accessNotes,
      trialGuidance: school.trialGuidance,
      pricing: school.pricing,
      welcomeMessage: school.welcomeMessage,
      agentInstructions: school.agentInstructions,
      faqs,
    }),
    stopWhen: ({ steps }) => {
      const stopped = stepCap({ steps });
      if (stopped && trace) trace.stepLimitTriggered = true;
      return stopped;
    },
    providerOptions: {
      gateway: {
        tags: ["feature:booking-chat"],
        user: school.id,
      },
    },
    tools: {
      list_trial_offerings: tool({
        description:
          "List trial offerings. Optionally filter by participant age in years.",
        inputSchema: z.object({
          participantAge: z.number().int().min(0).max(99).optional(),
        }),
        execute: async ({ participantAge }) => {
          const filtered = offerings.filter((offering) => {
            if (!offering.active) return false;
            if (participantAge == null) return true;
            return isAgeEligible(participantAge, offering);
          });
          return {
            offerings: filtered.map((offering) => ({
              id: offering.id,
              name: offering.name,
              description: offering.description,
              minimumAge: offering.minimumAge,
              maximumAge: offering.maximumAge,
              attire: offering.attire,
              expectations: offering.expectations,
            })),
            noMatch: filtered.length === 0,
          };
        },
      }),
      list_trial_slots: tool({
        description: "List currently open trial slots for one offering.",
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
      }),
      prepare_booking: tool({
        description:
          "Revalidate an offering and slot and return data for the booking confirmation flow. This does not create a booking. Collect the participant name and age first so the platform can book without asking again.",
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
            return { ok: false, reason: "invalid" };
          }
          const slots = listOpenSlots({
            offeringId,
            timezone: school.timezone,
            windows,
            occurrences,
            now,
          });
          const slot = slots.find((candidate) => candidate.slotId === slotId);
          if (!slot) return { ok: false, reason: "slot_unavailable" };
          return {
            ok: true,
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
      }),
      capture_lead: tool({
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
      }),
    },
  });
}
