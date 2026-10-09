import { randomUUID } from "node:crypto";
import { simulateReadableStream, type UIMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeSlotId } from "@/lib/schedule/slot-id";
import {
  type AssistantInput,
  type AssistantUIMessage,
  completedReply,
  type ReplyFinish,
  streamedReply,
} from "./assistant";

type ModelStep = Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;
type ModelStreamPart =
  Awaited<
    ReturnType<MockLanguageModelV4["doStream"]>
  >["stream"] extends ReadableStream<infer Part>
    ? Part
    : never;

const usage = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

function textStep(text: string): ModelStep {
  return {
    content: [{ type: "text", text }],
    finishReason: { unified: "stop", raw: undefined },
    usage,
    warnings: [],
  };
}

function toolCallStep(
  toolName: string,
  toolInput: Record<string, unknown>,
): ModelStep {
  return {
    content: [
      {
        type: "tool-call",
        toolCallId: randomUUID(),
        toolName,
        input: JSON.stringify(toolInput),
      },
    ],
    finishReason: { unified: "tool-calls", raw: undefined },
    usage,
    warnings: [],
  };
}

function scriptedModel(...steps: ModelStep[]) {
  return new MockLanguageModelV4({ doGenerate: steps });
}

// Step 1 lists the trial offerings. Step 2, once that tool result is back,
// streams the reply word by word.
function streamingModel(
  reply: string,
  { chunkDelayInMs = 0, modelId = "mock-model-id" } = {},
) {
  return new MockLanguageModelV4({
    modelId,
    doStream: async ({ prompt }) => {
      const chunks: ModelStreamPart[] =
        prompt.at(-1)?.role === "tool"
          ? [
              { type: "text-start", id: "reply" },
              ...reply.split(/(?<= )/).map(
                (delta): ModelStreamPart => ({
                  type: "text-delta",
                  id: "reply",
                  delta,
                }),
              ),
              { type: "text-end", id: "reply" },
              {
                type: "finish",
                finishReason: { unified: "stop", raw: undefined },
                usage,
              },
            ]
          : [
              {
                type: "tool-call",
                toolCallId: randomUUID(),
                toolName: "list_trial_offerings",
                input: "{}",
              },
              {
                type: "finish",
                finishReason: { unified: "tool-calls", raw: undefined },
                usage,
              },
            ];
      return { stream: simulateReadableStream({ chunks, chunkDelayInMs }) };
    },
  });
}

function textOf(message: AssistantUIMessage) {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

function toolOutputSentBackToModel(model: MockLanguageModelV4) {
  const toolMessage = model.doGenerateCalls[1]?.prompt.at(-1);
  if (toolMessage?.role !== "tool") return undefined;
  const [part] = toolMessage.content;
  return part?.type === "tool-result" ? part.output : undefined;
}

const school = {
  id: randomUUID(),
  name: "Tiger Dojo",
  timezone: "America/New_York",
  city: "Austin",
  address: null,
  phone: null,
  website: null,
  parkingNotes: null,
  accessNotes: null,
  trialGuidance: null,
  pricing: null,
  welcomeMessage: null,
  agentInstructions: null,
};

const kidsBjj = {
  id: randomUUID(),
  name: "Kids BJJ",
  description: null,
  minimumAge: 5,
  maximumAge: 12,
  attire: null,
  expectations: null,
  active: true,
};

const adultMuayThai = {
  id: randomUUID(),
  name: "Adult Muay Thai",
  description: null,
  minimumAge: 16,
  maximumAge: null,
  attire: null,
  expectations: null,
  active: false,
};

// Wednesdays at 18:00 in New York.
const kidsBjjWindow = {
  id: randomUUID(),
  trialOfferingId: kidsBjj.id,
  dayOfWeek: 3,
  startMinute: 18 * 60,
  durationMinutes: 60,
  capacity: 8,
  active: true,
  label: null,
};

// Monday 5 October 2026, 08:00 in New York.
const now = new Date("2026-10-05T12:00:00.000Z");
// Wednesday 7 October 2026, 18:00 in New York.
const openSlotId = encodeSlotId(
  kidsBjjWindow.id,
  new Date("2026-10-07T22:00:00.000Z"),
);
// Wednesday 14 October 2026, 18:00 in New York, already fully booked.
const fullOccurrence = {
  trialWindowId: kidsBjjWindow.id,
  startAt: new Date("2026-10-14T22:00:00.000Z"),
  capacity: 8,
  bookedCount: 8,
};
const fullSlotId = encodeSlotId(kidsBjjWindow.id, fullOccurrence.startAt);

const messages: UIMessage[] = [
  {
    id: "m1",
    role: "user",
    parts: [{ type: "text", text: "Can my son try Kids BJJ on Wednesday?" }],
  },
];

const input: AssistantInput = {
  school,
  catalog: {
    offerings: [kidsBjj, adultMuayThai],
    windows: [kidsBjjWindow],
    occurrences: [fullOccurrence],
    faqs: [],
  },
  messages,
  now,
};

describe("the assistant's completed reply", () => {
  it("returns only the reply text for a plain text answer", async () => {
    const reply = await completedReply({
      ...input,
      model: scriptedModel(textStep("Kids BJJ trains on Wednesdays.")),
    });

    expect(reply).toEqual({
      text: "Kids BJJ trains on Wednesdays.",
      bookingIntent: null,
      leadRequest: null,
    });
  });

  it("returns a Booking Intent with the participant when it prepares a booking for an open slot", async () => {
    const reply = await completedReply({
      ...input,
      model: scriptedModel(
        toolCallStep("prepare_booking", {
          offeringId: kidsBjj.id,
          slotId: openSlotId,
          participantName: "Ana",
          participantAge: 8,
        }),
        textStep("Ana can try Kids BJJ on Wednesday at 6:00 PM. Shall I book?"),
      ),
    });

    expect(reply).toEqual({
      text: "Ana can try Kids BJJ on Wednesday at 6:00 PM. Shall I book?",
      bookingIntent: {
        trialOfferingId: kidsBjj.id,
        slotId: openSlotId,
        participantName: "Ana",
        participantAge: 8,
      },
      leadRequest: null,
    });
  });

  it.each([
    {
      attempt: "an unavailable slot",
      offeringId: kidsBjj.id,
      slotId: fullSlotId,
      reason: "slot_unavailable",
    },
    {
      attempt: "an inactive trial offering",
      offeringId: adultMuayThai.id,
      slotId: openSlotId,
      reason: "invalid",
    },
    {
      attempt: "an unknown trial offering",
      offeringId: randomUUID(),
      slotId: openSlotId,
      reason: "invalid",
    },
  ])(
    "returns no Booking Intent when it tries to prepare $attempt",
    async ({ offeringId, slotId, reason }) => {
      const model = scriptedModel(
        toolCallStep("prepare_booking", {
          offeringId,
          slotId,
          participantName: "Ana",
          participantAge: 8,
        }),
        textStep("Sorry, I can't hold that time. Shall we look at others?"),
      );

      const reply = await completedReply({ ...input, model });

      expect(toolOutputSentBackToModel(model)).toEqual({
        type: "json",
        value: { ok: false, reason },
      });
      expect(reply).toEqual({
        text: "Sorry, I can't hold that time. Shall we look at others?",
        bookingIntent: null,
        leadRequest: null,
      });
    },
  );

  it("returns no Booking Intent when a later attempt in the turn fails", async () => {
    const reply = await completedReply({
      ...input,
      model: scriptedModel(
        toolCallStep("prepare_booking", {
          offeringId: kidsBjj.id,
          slotId: openSlotId,
        }),
        toolCallStep("prepare_booking", {
          offeringId: kidsBjj.id,
          slotId: fullSlotId,
        }),
        textStep("Next Wednesday is full. Which day suits you?"),
      ),
    });

    expect(reply.bookingIntent).toBeNull();
  });

  it("returns a Lead Request when it captures a request to be contacted", async () => {
    const reply = await completedReply({
      ...input,
      model: scriptedModel(
        toolCallStep("capture_lead", {
          participantName: "Sam",
          participantAge: 34,
          statedNeed: "Adult evening classes",
        }),
        textStep("Thanks Sam, the school will be in touch."),
      ),
    });

    expect(reply).toEqual({
      text: "Thanks Sam, the school will be in touch.",
      bookingIntent: null,
      leadRequest: {
        participantName: "Sam",
        participantAge: 34,
        trialOfferingId: null,
        statedNeed: "Adult evening classes",
      },
    });
  });
});

describe("the assistant's completed reply with no model passed", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL_OIDC_TOKEN", undefined);
    vi.stubEnv("AI_GATEWAY_API_KEY", undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the scripted local model outside production without a Gateway token, naming the active trial offerings", async () => {
    const reply = await completedReply(input);

    expect(reply).toEqual({
      text: "Local scripted reply (no AI Gateway token). Trial offerings: Kids BJJ.",
      bookingIntent: null,
      leadRequest: null,
    });
  });

  it("replies with a fallback sentence when there are no active trial offerings", async () => {
    const reply = await completedReply({
      ...input,
      catalog: { ...input.catalog, offerings: [adultMuayThai] },
    });

    expect(reply.text).toBe(
      "Local scripted reply (no AI Gateway token). There are no active trial offerings.",
    );
  });
});

describe("the assistant's streamed reply", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const kidsBjjListing = {
    id: kidsBjj.id,
    name: "Kids BJJ",
    description: null,
    minimumAge: 5,
    maximumAge: 12,
    attire: null,
    expectations: null,
  };

  it("calls back once with the final reply and complete status when the response is read to the end", async () => {
    const finishes: ReplyFinish[] = [];
    const response = await streamedReply({
      ...input,
      model: streamingModel("We offer Kids BJJ."),
      onFinish: (finish) => {
        finishes.push(finish);
      },
    });

    await response.text();

    expect(finishes).toHaveLength(1);
    const [{ reply, completion }] = finishes;
    expect(completion).toBe("complete");
    expect(reply.id).not.toBe("");
    expect(reply.role).toBe("assistant");
    expect(reply.parts).toEqual([
      { type: "step-start" },
      expect.objectContaining({
        type: "tool-list_trial_offerings",
        state: "output-available",
        output: { offerings: [kidsBjjListing], noMatch: false },
      }),
      { type: "step-start" },
      expect.objectContaining({
        type: "text",
        text: "We offer Kids BJJ.",
        state: "done",
      }),
    ]);
  });

  it("calls back with the id of the model that wrote the reply", async () => {
    const finishes: ReplyFinish[] = [];
    const response = await streamedReply({
      ...input,
      model: streamingModel("We offer Kids BJJ.", {
        modelId: "anthropic/claude-sonnet-4.6",
      }),
      onFinish: (finish) => {
        finishes.push(finish);
      },
    });

    await response.text();

    expect(finishes.map(({ modelId }) => modelId)).toEqual([
      "anthropic/claude-sonnet-4.6",
    ]);
  });

  it("still finishes the reply and calls back once with complete status when the consumer cancels the response stream", async () => {
    const finishes: ReplyFinish[] = [];
    const firstFinish = Promise.withResolvers<void>();
    const response = await streamedReply({
      ...input,
      model: streamingModel("We offer Kids BJJ on Wednesdays at 6 PM.", {
        chunkDelayInMs: 5,
      }),
      onFinish: (finish) => {
        finishes.push(finish);
        firstFinish.resolve();
      },
    });

    const body = response.body?.getReader();
    await body?.read();
    await body?.cancel();
    await firstFinish.promise;
    // Leave time for a second call to show up.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(
      finishes.map(({ reply, completion }) => [completion, textOf(reply)]),
    ).toEqual([["complete", "We offer Kids BJJ on Wednesdays at 6 PM."]]);
  });

  it.each([
    {
      failure: "cannot be reached",
      doStream: async () => {
        throw new Error("Gateway unavailable");
      },
    },
    {
      failure: "fails part-way through the reply",
      doStream: async () => ({
        stream: simulateReadableStream<ModelStreamPart>({
          chunks: [
            { type: "text-start", id: "reply" },
            { type: "text-delta", id: "reply", delta: "We offer " },
            { type: "error", error: new Error("Model overloaded") },
            {
              type: "finish",
              finishReason: { unified: "error", raw: undefined },
              usage,
            },
          ],
        }),
      }),
    },
  ])(
    "calls back once with error status when the model $failure",
    async ({ doStream }) => {
      // The AI SDK logs model errors.
      vi.spyOn(console, "error").mockImplementation(() => {});
      const finishes: ReplyFinish[] = [];
      const response = await streamedReply({
        ...input,
        model: new MockLanguageModelV4({ doStream }),
        onFinish: (finish) => {
          finishes.push(finish);
        },
      });

      await response.text();

      expect(finishes.map(({ completion }) => completion)).toEqual(["error"]);
    },
  );

  it("still ends the response, and rejects nothing unhandled, when the finish callback throws", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const unhandled: unknown[] = [];
    const recordUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", recordUnhandled);
    try {
      const response = await streamedReply({
        ...input,
        model: streamingModel("We offer Kids BJJ."),
        onFinish: () => {
          throw new Error("Database unavailable");
        },
      });

      const body = await response.text();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(body).toMatch(/data: \[DONE\]\n\n$/);
      expect(unhandled).toEqual([]);
      expect(logged).toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", recordUnhandled);
    }
  });
});
