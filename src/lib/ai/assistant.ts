import {
  convertToModelMessages,
  type InferToolOutput,
  isStepCount,
  type LanguageModel,
  ToolLoopAgent,
  tool,
  type UIMessage,
} from "ai";
import { z } from "zod";
import type { Faq, School, TrialOffering } from "@/db/schema";
import {
  isAgeEligible,
  listOpenSlots,
  type SlotOccurrence,
  type SlotWindow,
} from "@/lib/schedule/occurrences";
import { parseSlotId } from "@/lib/schedule/slot-id";
import { MAX_AGENT_STEPS } from "@/lib/security/limits";
import { defaultLanguageModel, gatewayLanguageModel } from "./language-model";
import { buildBookingAgentInstructions } from "./system-prompt";

export type AssistantSchool = Pick<
  School,
  | "id"
  | "name"
  | "timezone"
  | "city"
  | "address"
  | "phone"
  | "website"
  | "parkingNotes"
  | "accessNotes"
  | "trialGuidance"
  | "pricing"
  | "welcomeMessage"
  | "agentInstructions"
>;

export type SchoolCatalog = {
  offerings: Array<
    Pick<
      TrialOffering,
      | "id"
      | "name"
      | "description"
      | "minimumAge"
      | "maximumAge"
      | "attire"
      | "expectations"
      | "active"
    >
  >;
  windows: SlotWindow[];
  occurrences: SlotOccurrence[];
  faqs: Array<Pick<Faq, "question" | "answer">>;
};

export type AssistantInput = {
  school: AssistantSchool;
  catalog: SchoolCatalog;
  messages: UIMessage[];
  now: Date;
  /** Defaults to `defaultLanguageModel()`, chosen when the reply is made. */
  model?: LanguageModel;
};

function createAssistant({
  school,
  catalog: { offerings, windows, occurrences, faqs },
  now,
  model,
}: Omit<AssistantInput, "messages" | "model"> & { model: LanguageModel }) {
  return new ToolLoopAgent({
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
    stopWhen: isStepCount(MAX_AGENT_STEPS),
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
            return { ok: false as const, reason: "invalid" as const };
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

type AssistantTools = ReturnType<typeof createAssistant>["tools"];
type PreparedBooking = Extract<
  InferToolOutput<AssistantTools["prepare_booking"]>,
  { ok: true }
>;

export type BookingIntent = {
  trialOfferingId: PreparedBooking["offering"]["id"];
  slotId: PreparedBooking["slot"]["slotId"];
  participantName: PreparedBooking["participantName"];
  participantAge: PreparedBooking["participantAge"];
};

type CapturedLead = InferToolOutput<AssistantTools["capture_lead"]>;

export type LeadRequest = {
  participantName: CapturedLead["participantName"];
  participantAge: CapturedLead["participantAge"];
  trialOfferingId: CapturedLead["offeringId"];
  statedNeed: CapturedLead["statedNeed"];
};

export type CompletedReply = {
  text: string;
  bookingIntent: BookingIntent | null;
  leadRequest: LeadRequest | null;
};

/**
 * Runs the assistant over the conversation to completion (WhatsApp) and
 * returns its reply with any Booking Intent or Lead Request it gathered.
 */
export async function completedReply({
  messages,
  model,
  ...input
}: AssistantInput): Promise<CompletedReply> {
  const assistant = createAssistant({
    ...input,
    model: model ?? defaultLanguageModel(),
  });
  const result = await assistant.generate({
    messages: await convertToModelMessages(messages, {
      tools: assistant.tools,
    }),
  });
  // The last result wins: a failed attempt after a successful one cancels it.
  const prepared = result.staticToolResults.findLast(
    (toolResult) => toolResult.toolName === "prepare_booking",
  );
  const lead = result.staticToolResults.findLast(
    (toolResult) => toolResult.toolName === "capture_lead",
  );
  return {
    text: result.text.trim(),
    bookingIntent: prepared?.output.ok
      ? {
          trialOfferingId: prepared.output.offering.id,
          slotId: prepared.output.slot.slotId,
          participantName: prepared.output.participantName,
          participantAge: prepared.output.participantAge,
        }
      : null,
    leadRequest: lead
      ? {
          participantName: lead.output.participantName,
          participantAge: lead.output.participantAge,
          trialOfferingId: lead.output.offeringId,
          statedNeed: lead.output.statedNeed,
        }
      : null,
  };
}

/**
 * @deprecated Transitional (#49): only the web chat route still builds the
 * agent itself, behind its own local-stub branch. #50 moves the route onto the
 * assistant's streamed reply and deletes this export.
 */
export function createBookingAgent({
  offerings,
  windows,
  occurrences,
  faqs,
  ...input
}: Pick<AssistantInput, "school" | "now"> & SchoolCatalog) {
  return createAssistant({
    ...input,
    catalog: { offerings, windows, occurrences, faqs },
    model: gatewayLanguageModel(),
  });
}
