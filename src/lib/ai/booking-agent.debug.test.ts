import { strict as assert } from "node:assert";
import { MockLanguageModelV4 } from "ai/test";
import { describe, it } from "vitest";
import type { School, TrialOffering } from "@/db/schema";
import { type BookingTraceState, createBookingAgent } from "./booking-agent";

const school = {
  id: "00000000-0000-4000-8000-000000000011",
  name: "Synthetic Dojo",
  timezone: "America/New_York",
  city: null,
  address: null,
  phone: null,
  website: null,
  parkingNotes: null,
  accessNotes: null,
  trialGuidance: null,
  pricing: null,
  welcomeMessage: null,
  agentInstructions: null,
} as School;
const offeringId = "00000000-0000-4000-8000-000000000005";
const offerings = [
  {
    id: offeringId,
    name: "Kids beginner trial",
    active: true,
    minimumAge: 5,
    maximumAge: 8,
    description: null,
    attire: null,
    expectations: null,
  },
] as TrialOffering[];
const usage = {
  inputTokens: {
    total: 10,
    noCache: 10,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 10, text: 10, reasoning: undefined },
};

describe("booking agent synthetic failure / recovery", () => {
  it("records the stop predicate actually firing at the enforced cap", async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        calls++;
        return {
          content: [
            {
              type: "tool-call" as const,
              toolCallType: "function" as const,
              toolCallId: `offering-${calls}`,
              toolName: "list_trial_offerings",
              input: '{"participantAge":5}',
            },
          ],
          finishReason: { unified: "tool-calls" as const, raw: undefined },
          usage,
          warnings: [],
        };
      },
    });
    const trace: BookingTraceState = {
      integration: {},
      stepCount: 0,
      stepLimitTriggered: false,
      generationOutcome: "pending",
    };
    await createBookingAgent({
      school,
      offerings,
      windows: [],
      occurrences: [],
      faqs: [],
      now: new Date("2026-10-06T12:00:00Z"),
      model,
      trace,
    }).generate({ prompt: "Check classes" });
    assert.equal(calls, 8);
    assert.equal(trace.stepCount, 8);
    assert.equal(trace.stepLimitTriggered, true);
  });

  it("records a technically completed promise with no slot tool, then a separate turn with actual lookup", async () => {
    const tools: string[] = [];
    let call = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        call += 1;
        const content =
          call === 1
            ? [{ type: "text" as const, text: "I'll check the slots." }]
            : call === 2
              ? [
                  {
                    type: "tool-call" as const,
                    toolCallType: "function" as const,
                    toolCallId: "offer-1",
                    toolName: "list_trial_offerings",
                    input: '{"participantAge":5}',
                  },
                ]
              : call === 3
                ? [
                    {
                      type: "tool-call" as const,
                      toolCallType: "function" as const,
                      toolCallId: "slots-1",
                      toolName: "list_trial_slots",
                      input: JSON.stringify({ offeringId }),
                    },
                  ]
                : [
                    {
                      type: "text" as const,
                      text: "No Tuesday slots currently match.",
                    },
                  ];
        return {
          content,
          finishReason: {
            unified:
              call === 2 || call === 3
                ? ("tool-calls" as const)
                : ("stop" as const),
            raw: undefined,
          },
          usage,
          warnings: [],
        };
      },
    });
    const trace = (): BookingTraceState => ({
      integration: {
        onToolExecutionEnd(event) {
          tools.push(event.toolCall.toolName);
        },
      },
      stepCount: 0,
      stepLimitTriggered: false,
      generationOutcome: "pending",
    });
    const args = {
      school,
      offerings,
      windows: [],
      occurrences: [],
      faqs: [],
      now: new Date("2026-10-06T12:00:00Z"),
      model,
    };
    const first = trace();
    const stalled = await createBookingAgent({
      ...args,
      trace: first,
    }).generate({ prompt: "Tuesday for a five-year-old?" });
    assert.match(stalled.text, /check the slots/i);
    assert.equal(first.generationOutcome, "complete");
    assert.equal(first.stepCount, 1);
    assert.equal(first.stepLimitTriggered, false);
    assert.deepEqual(tools, []);
    const recovery = trace();
    const recovered = await createBookingAgent({
      ...args,
      trace: recovery,
    }).generate({
      messages: [
        { role: "user", content: "Tuesday for a five-year-old?" },
        { role: "assistant", content: stalled.text },
        { role: "user", content: "Did you find any Tuesday times?" },
      ],
    });
    assert.match(recovered.text, /No Tuesday slots/);
    assert.equal(recovery.stepCount, 3);
    assert.equal(recovery.stepLimitTriggered, false);
    assert.deepEqual(tools, ["list_trial_offerings", "list_trial_slots"]);
  });
});
