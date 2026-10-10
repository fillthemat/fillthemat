import { MockLanguageModelV4 } from "ai/test";
import { expect, it } from "vitest";
import { cases } from "./cases";
import { runCase } from "./runner";

it("scores tool calls and public reply intents through the real assistant without network", async () => {
  const usage = {
    inputTokens: {
      total: 1,
      noCache: 1,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: { total: 1, text: 1, reasoning: undefined },
  };
  const model = new MockLanguageModelV4({
    doGenerate: [
      {
        content: [
          {
            type: "tool-call",
            toolCallId: "call",
            toolName: "list_trial_offerings",
            input: '{"participantAge":5}',
          },
        ],
        finishReason: { unified: "tool-calls", raw: undefined },
        usage,
        warnings: [],
      },
      {
        content: [{ type: "text", text: "Kids Beginner Trial is suitable." }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      },
    ],
  });
  const result = await runCase(cases[2], model);
  expect(result.toolCalls).toEqual(["list_trial_offerings"]);
  expect(result.reply.bookingIntent).toBeNull();
  expect(result.reply.leadRequest).toBeNull();
  expect(result.scores.map((s) => s.value)).toEqual([1, 1, 1, 1, 1]);

  const contactModel = new MockLanguageModelV4({
    doGenerate: async (params) => {
      if (params.prompt.at(-1)?.role === "tool")
        return {
          content: [
            { type: "text", text: "Please confirm your contact request." },
          ],
          finishReason: { unified: "stop", raw: undefined },
          usage,
          warnings: [],
        };
      return {
        content: [
          {
            type: "tool-call",
            toolCallId: "contact",
            toolName: "request_contact",
            input:
              '{"participantName":"Sam","participantAge":5,"statedNeed":"Contact me about a trial"}',
          },
        ],
        finishReason: { unified: "tool-calls", raw: undefined },
        usage,
        warnings: [],
      };
    },
  });
  const contactCase = cases.find((row) => row.id === "explicit-contact");
  if (!contactCase) throw new Error("Missing contact case");
  const contact = await runCase(contactCase, contactModel);
  expect(contact.toolCalls).toEqual(["request_contact"]);
  expect(contact.reply.leadRequest).toEqual({
    participantName: "Sam",
    participantAge: 5,
    trialOfferingId: null,
    statedNeed: "Contact me about a trial",
  });
  expect(contact.scores.map((s) => s.value)).toEqual([1, 1, 1, 1]);

  const bookingCase = cases.find((row) => row.id === "happy-booking");
  if (!bookingCase?.expectedOutput.bookingIntent)
    throw new Error("Missing booking case");
  const bookingModel = new MockLanguageModelV4({
    doGenerate: [
      {
        content: [
          {
            type: "tool-call",
            toolCallId: "booking",
            toolName: "prepare_booking",
            input: JSON.stringify({
              offeringId: "00000000-0000-4000-8000-000000000002",
              slotId: bookingCase.expectedOutput.bookingIntent.slotId,
              participantName: "Sam",
              participantAge: 5,
            }),
          },
        ],
        finishReason: { unified: "tool-calls", raw: undefined },
        usage,
        warnings: [],
      },
      {
        content: [{ type: "text", text: "Please confirm the trial booking." }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      },
    ],
  });
  const booking = await runCase(bookingCase, bookingModel);
  expect(booking.reply.bookingIntent?.participantName).toBe("Sam");
  expect(booking.reply.bookingIntent?.participantAge).toBe(5);
  expect(booking.reply.leadRequest).toBeNull();
  expect(booking.scores.map((s) => s.value)).toEqual([1, 1, 1, 1]);
});
