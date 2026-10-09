import { createHash } from "node:crypto";
import {
  consumeStream,
  convertToModelMessages,
  createAgentUIStream,
  createUIMessageStreamResponse,
  generateId,
  type InferAgentUIMessage,
  type InferToolOutput,
  isStepCount,
  type LanguageModel,
  ToolLoopAgent,
  tool,
  type UIMessage,
  type UIMessageChunk,
  type UIMessageStreamOnEndCallback,
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
import { defaultLanguageModel } from "./language-model";
import {
  buildBookingAgentInstructions,
  PLATFORM_INSTRUCTIONS,
  type SchoolPromptInput,
} from "./system-prompt";

/** A short hash of the platform instructions every reply follows. */
export const PLATFORM_INSTRUCTIONS_HASH = createHash("sha256")
  .update(PLATFORM_INSTRUCTIONS)
  .digest("hex")
  .slice(0, 12);

/** The school's id plus the details its instructions show the model. */
export type AssistantSchool = Pick<School, "id"> &
  Omit<SchoolPromptInput, "faqs">;

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
  model = defaultLanguageModel(),
}: Omit<AssistantInput, "messages">) {
  const assistant = new ToolLoopAgent({
    model,
    // The builder reads only its own fields, so the rest of a School row
    // never reaches the instructions.
    instructions: buildBookingAgentInstructions({ ...school, faqs }),
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
  return {
    assistant,
    modelId: typeof model === "string" ? model : model.modelId,
  };
}

type Assistant = ReturnType<typeof createAssistant>["assistant"];

/** A web chat message whose tool parts are typed by the assistant's tools. */
export type AssistantUIMessage = InferAgentUIMessage<Assistant>;

type AssistantTools = Assistant["tools"];
type PrepareBookingOk = Extract<
  InferToolOutput<AssistantTools["prepare_booking"]>,
  { ok: true }
>;

export type BookingIntent = {
  trialOfferingId: PrepareBookingOk["offering"]["id"];
  slotId: PrepareBookingOk["slot"]["slotId"];
  participantName: PrepareBookingOk["participantName"];
  participantAge: PrepareBookingOk["participantAge"];
};

type CaptureLeadOutput = InferToolOutput<AssistantTools["capture_lead"]>;

export type LeadRequest = {
  participantName: CaptureLeadOutput["participantName"];
  participantAge: CaptureLeadOutput["participantAge"];
  trialOfferingId: CaptureLeadOutput["offeringId"];
  statedNeed: CaptureLeadOutput["statedNeed"];
};

export type CompletedReply = {
  text: string;
  bookingIntent: BookingIntent | null;
  leadRequest: LeadRequest | null;
  /** The language model that wrote the reply. */
  modelId: string;
};

/**
 * Runs the assistant over the conversation to completion (WhatsApp) and
 * returns its reply with any Booking Intent or Lead Request it gathered.
 */
export async function completedReply({
  messages,
  ...input
}: AssistantInput): Promise<CompletedReply> {
  const { assistant, modelId } = createAssistant(input);
  const result = await assistant.generate({
    messages: await convertToModelMessages(messages, {
      tools: assistant.tools,
    }),
  });
  // The last result wins: a failed attempt after a successful one cancels it.
  const lastPrepareBooking = result.staticToolResults.findLast(
    (toolResult) => toolResult.toolName === "prepare_booking",
  );
  const lastCaptureLead = result.staticToolResults.findLast(
    (toolResult) => toolResult.toolName === "capture_lead",
  );
  return {
    text: result.text.trim(),
    bookingIntent: lastPrepareBooking?.output.ok
      ? {
          trialOfferingId: lastPrepareBooking.output.offering.id,
          slotId: lastPrepareBooking.output.slot.slotId,
          participantName: lastPrepareBooking.output.participantName,
          participantAge: lastPrepareBooking.output.participantAge,
        }
      : null,
    leadRequest: lastCaptureLead
      ? {
          participantName: lastCaptureLead.output.participantName,
          participantAge: lastCaptureLead.output.participantAge,
          trialOfferingId: lastCaptureLead.output.offeringId,
          statedNeed: lastCaptureLead.output.statedNeed,
        }
      : null,
    modelId,
  };
}

/** How a streamed reply ended, as saved with the reply message. */
export type ReplyCompletion = "complete" | "aborted" | "error";

export type ReplyFinish = {
  reply: AssistantUIMessage;
  completion: ReplyCompletion;
  /** The language model that wrote the reply. */
  modelId: string;
};

type StreamEnd = Parameters<
  UIMessageStreamOnEndCallback<AssistantUIMessage>
>[0];

// A model error part mid-stream still reports a completed outcome, with an
// error finish reason. A stream that ends without an outcome was cut short.
function replyCompletion({
  outcome,
  isAborted,
  finishReason,
}: StreamEnd): ReplyCompletion {
  if (outcome.status === "failed" || finishReason === "error") return "error";
  return outcome.status === "completed" && !isAborted ? "complete" : "aborted";
}

/**
 * Streams the assistant's reply over the conversation (web chat) as a UI
 * message stream response. The reply keeps generating after the browser
 * disconnects, and `onFinish` is called exactly once with the final reply.
 * If `onFinish` throws, the error is logged and the stream ends with an error
 * chunk. If this function rejects, the reply never started and `onFinish` is
 * never called.
 */
export async function streamedReply({
  messages,
  onFinish,
  ...input
}: AssistantInput & {
  onFinish: (finish: ReplyFinish) => Promise<void> | void;
}): Promise<Response> {
  const { assistant, modelId } = createAssistant(input);
  let finishFailed = false;
  const stream = await createAgentUIStream({
    agent: assistant,
    uiMessages: messages,
    generateMessageId: generateId,
    onEnd: async (end: StreamEnd) => {
      try {
        await onFinish({
          reply: end.responseMessage,
          completion: replyCompletion(end),
          modelId,
        });
      } catch (error) {
        // Rethrowing would cut the response off mid-stream, which looks like
        // a dropped connection rather than a failed reply.
        console.error("assistant: streamed reply onFinish failed", error);
        finishFailed = true;
      }
    },
  });
  return createUIMessageStreamResponse({
    // The agent's stream only closes once `onEnd` has settled, so
    // `finishFailed` is final by the time this flushes.
    stream: stream.pipeThrough(
      new TransformStream<UIMessageChunk, UIMessageChunk>({
        flush(controller) {
          if (finishFailed) {
            controller.enqueue({
              type: "error",
              errorText: "An error occurred.",
            });
          }
        },
      }),
    ),
    // Reading a copy of the stream to the end keeps the reply generating, and
    // `onEnd` coming, after the browser disconnects.
    consumeSseStream: consumeStream,
  });
}
