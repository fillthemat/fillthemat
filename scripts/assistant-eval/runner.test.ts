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
});
