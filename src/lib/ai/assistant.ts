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
  type UIMessage,
  type UIMessageChunk,
  type UIMessageStreamOnEndCallback,
} from "ai";
import { MAX_AGENT_STEPS } from "@/lib/security/limits";
import type { AssistantContext } from "./context";
import { assistantInstructions, PLATFORM_INSTRUCTIONS } from "./instructions";
import { defaultLanguageModel } from "./language-model";
import { assistantTools } from "./tools";

export type { AssistantSchool, SchoolCatalog } from "./context";

const PLATFORM_INSTRUCTIONS_HASH = createHash("sha256")
  .update(PLATFORM_INSTRUCTIONS)
  .digest("hex")
  .slice(0, 12);

/** What a reply came from. */
export type ReplyProvenance = {
  /** The language model that wrote the reply. */
  modelId: string;
  /** A short hash of the platform instructions every reply follows. */
  platformInstructionsHash: string;
};

export type AssistantInput = AssistantContext & {
  messages: UIMessage[];
  /** Defaults to `defaultLanguageModel()`, chosen when the reply is made. */
  model?: LanguageModel;
};

function createAssistant({
  school,
  catalog,
  now,
  model = defaultLanguageModel(),
}: Omit<AssistantInput, "messages">) {
  const assistant = new ToolLoopAgent({
    model,
    // The builder reads only its own fields, so the rest of a School row
    // never reaches the instructions.
    instructions: assistantInstructions({ ...school, faqs: catalog.faqs }),
    stopWhen: isStepCount(MAX_AGENT_STEPS),
    providerOptions: {
      gateway: {
        tags: ["feature:booking-chat"],
        user: school.id,
      },
    },
    tools: assistantTools({ school, catalog, now }),
  });
  const provenance: ReplyProvenance = {
    modelId: typeof model === "string" ? model : model.modelId,
    platformInstructionsHash: PLATFORM_INSTRUCTIONS_HASH,
  };
  return { assistant, provenance };
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
  provenance: ReplyProvenance;
};

/**
 * Runs the assistant over the conversation to completion (WhatsApp) and
 * returns its reply with any Booking Intent or Lead Request it gathered.
 */
export async function completedReply({
  messages,
  ...input
}: AssistantInput): Promise<CompletedReply> {
  const { assistant, provenance } = createAssistant(input);
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
    provenance,
  };
}

/** How a streamed reply ended, as saved with the reply message. */
export type ReplyCompletion = "complete" | "aborted" | "error";

export type ReplyFinish = {
  reply: AssistantUIMessage;
  completion: ReplyCompletion;
  provenance: ReplyProvenance;
};

type StreamEnd = Parameters<
  UIMessageStreamOnEndCallback<AssistantUIMessage>
>[0];

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
  const { assistant, provenance } = createAssistant(input);
  let finishFailed = false;
  const stream = await createAgentUIStream({
    agent: assistant,
    uiMessages: messages,
    generateMessageId: generateId,
    onEnd: async (end: StreamEnd) => {
      // A model error part mid-stream can still report a completed outcome.
      // A stream that ends without a completed outcome was cut short.
      const completion: ReplyCompletion =
        end.outcome.status === "failed" || end.finishReason === "error"
          ? "error"
          : end.outcome.status === "completed" && !end.isAborted
            ? "complete"
            : "aborted";
      try {
        await onFinish({
          reply: end.responseMessage,
          completion,
          provenance,
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
