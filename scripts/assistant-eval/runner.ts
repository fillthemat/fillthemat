import { type LanguageModel, wrapLanguageModel } from "ai";
import {
  type CompletedReply,
  completedReply,
} from "../../src/lib/ai/assistant";
import type { EvalCase } from "./cases";
import { type Score, scoreIntents, scoreToolCalls } from "./scoring";

export type CaseResult = {
  caseId: string;
  reply: CompletedReply;
  toolCalls: string[];
  scores: Score[];
};

/** Observe the model boundary, not the assistant's tool registration or intent extraction. */
export async function runCase(
  testCase: EvalCase,
  model: Exclude<LanguageModel, string>,
  reply = completedReply,
): Promise<CaseResult> {
  const toolCalls: string[] = [];
  const observed = wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: "v4",
      transformParams: async ({ params }) => ({ ...params, temperature: 0 }),
      wrapGenerate: async ({ doGenerate }) => {
        const result = await doGenerate();
        toolCalls.push(
          ...result.content.flatMap((part) =>
            part.type === "tool-call" ? [part.toolName] : [],
          ),
        );
        return result;
      },
    },
  });
  const output = await reply({ ...testCase.input, model: observed });
  return {
    caseId: testCase.id,
    reply: output,
    toolCalls,
    scores: [
      ...scoreToolCalls(testCase.expectedOutput, toolCalls),
      ...scoreIntents(testCase.expectedOutput, output),
    ],
  };
}
