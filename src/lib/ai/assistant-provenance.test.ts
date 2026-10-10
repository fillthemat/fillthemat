import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  type AssistantInput,
  completedReply,
  type ReplyFinish,
  streamedReply,
} from "./assistant";
import { platformInstructionsHash } from "./provenance";
import { assistantTools } from "./tools";

const input: AssistantInput = {
  school: {
    id: "school-1",
    name: "Tiger Dojo",
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
  },
  catalog: { offerings: [], windows: [], occurrences: [], faqs: [] },
  now: new Date("2026-10-05T12:00:00.000Z"),
  messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "Hi" }] }],
};

function model() {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text: "Hello!" }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: {
          total: 1,
          noCache: 1,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: 1, text: 1, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}

describe("assistant reply provenance", () => {
  it("uses the hash of the registered tool definitions alongside platform instructions", async () => {
    const reply = await completedReply({ ...input, model: model() });

    expect(reply.provenance.platformInstructionsHash).toBe(
      await platformInstructionsHash(assistantTools(input)),
    );
  });

  it("uses the same provenance for completed and streamed replies", async () => {
    const completed = await completedReply({ ...input, model: model() });
    const finishes: ReplyFinish[] = [];
    const response = await streamedReply({
      ...input,
      model: new MockLanguageModelV4({
        doStream: async () => ({
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: "text-start", id: "reply" });
              controller.enqueue({
                type: "text-delta",
                id: "reply",
                delta: "Hello!",
              });
              controller.enqueue({ type: "text-end", id: "reply" });
              controller.enqueue({
                type: "finish",
                finishReason: { unified: "stop", raw: undefined },
                usage: {
                  inputTokens: {
                    total: 1,
                    noCache: 1,
                    cacheRead: undefined,
                    cacheWrite: undefined,
                  },
                  outputTokens: { total: 1, text: 1, reasoning: undefined },
                },
              });
              controller.close();
            },
          }),
        }),
      }),
      onFinish: (finish) => {
        finishes.push(finish);
      },
    });

    await response.text();

    expect(finishes).toHaveLength(1);
    expect(finishes[0].provenance).toEqual(completed.provenance);
  });

  it.each([
    {
      change: "school profile",
      changed: {
        ...input,
        school: {
          ...input.school,
          id: "school-2",
          name: "Dragon Dojo",
          timezone: "America/Chicago",
          city: "Austin",
          address: "12 Main St",
          phone: "+15125550100",
          website: "https://dragon.test",
          parkingNotes: "Park behind the building.",
          accessNotes: "Step-free entrance.",
          trialGuidance: "Arrive early.",
          pricing: "$120 a month.",
          welcomeMessage: "Welcome!",
        },
      },
    },
    {
      change: "FAQs",
      changed: {
        ...input,
        catalog: {
          ...input.catalog,
          faqs: [{ question: "Do I need a gi?", answer: "No." }],
        },
      },
    },
    {
      change: "owner instructions",
      changed: {
        ...input,
        school: { ...input.school, agentInstructions: "Keep answers short." },
      },
    },
    {
      change: "catalog",
      changed: {
        ...input,
        catalog: {
          ...input.catalog,
          offerings: [
            {
              id: "offering-1",
              name: "Kids BJJ",
              description: "Beginner classes.",
              minimumAge: 5,
              maximumAge: 12,
              attire: "Sportswear",
              expectations: "Have fun.",
              active: true,
            },
          ],
          windows: [
            {
              id: "window-1",
              trialOfferingId: "offering-1",
              dayOfWeek: 3,
              startMinute: 1080,
              durationMinutes: 60,
              capacity: 8,
              active: true,
              label: null,
            },
          ],
          occurrences: [
            {
              trialWindowId: "window-1",
              startAt: new Date("2026-10-07T22:00:00.000Z"),
              capacity: 8,
              bookedCount: 2,
            },
          ],
        },
      },
    },
    {
      change: "now",
      changed: { ...input, now: new Date("2026-10-12T12:00:00.000Z") },
    },
  ])("does not change when $change changes", async ({ changed }) => {
    const original = await completedReply({ ...input, model: model() });
    const reply = await completedReply({ ...changed, model: model() });

    expect(reply.provenance.platformInstructionsHash).toBe(
      original.provenance.platformInstructionsHash,
    );
  });

  it("changes for the description and input schema of every registered tool", async () => {
    const tools = assistantTools(input);
    const original = await platformInstructionsHash(tools);
    for (const [name, definition] of Object.entries(tools)) {
      expect(
        await platformInstructionsHash({
          ...tools,
          [name]: {
            ...definition,
            description: `${definition.description} Changed rule.`,
          },
        }),
      ).not.toBe(original);
      expect(
        await platformInstructionsHash({
          ...tools,
          [name]: {
            ...definition,
            inputSchema: z.object({ newRequirement: z.string() }),
          },
        }),
      ).not.toBe(original);
    }
  });
});
