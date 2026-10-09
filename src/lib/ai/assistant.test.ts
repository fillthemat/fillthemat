import { randomUUID } from "node:crypto";
import type { UIMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { encodeSlotId } from "@/lib/schedule/slot-id";
import { type AssistantInput, completedReply } from "./assistant";

type ModelStep = Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;

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
