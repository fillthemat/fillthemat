import { gateway, generateId, type LanguageModel } from "ai";
import { z } from "zod";

type LanguageModelV4 = Extract<LanguageModel, { specificationVersion: "v4" }>;
type Prompt = Parameters<LanguageModelV4["doGenerate"]>[0]["prompt"];
type StreamPart =
  Awaited<
    ReturnType<LanguageModelV4["doStream"]>
  >["stream"] extends ReadableStream<infer Part>
    ? Part
    : never;

export function gatewayLanguageModel(): LanguageModelV4 {
  return gateway(
    process.env.BOOKING_AGENT_MODEL || "anthropic/claude-sonnet-4.6",
  );
}

/**
 * The Gateway model in production or whenever a Gateway token is present.
 * Otherwise (local dev and tests only) a scripted local model, so the real
 * assistant and its tools run without a paid model call.
 */
export function defaultLanguageModel(): LanguageModelV4 {
  const hasGatewayToken = Boolean(
    process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN,
  );
  if (process.env.NODE_ENV === "production" || hasGatewayToken) {
    return gatewayLanguageModel();
  }
  return scriptedLocalModel;
}

const listedOfferings = z.object({
  offerings: z.array(z.object({ name: z.string() })),
});

// Step 1 calls list_trial_offerings. Step 2, whose prompt ends with that tool
// result, replies naming the offerings. It never proposes a Booking Intent or
// a Lead Request.
function scriptedStep(prompt: Prompt) {
  const last = prompt.at(-1);
  if (last?.role !== "tool") {
    return {
      type: "tool-call" as const,
      toolCallId: generateId(),
      toolName: "list_trial_offerings",
      input: "{}",
    };
  }
  const names = last.content.flatMap((part) => {
    if (part.type !== "tool-result" || part.output.type !== "json") return [];
    const parsed = listedOfferings.safeParse(part.output.value);
    return parsed.success ? parsed.data.offerings.map(({ name }) => name) : [];
  });
  const text =
    names.length > 0
      ? `Local scripted reply (no AI Gateway token). Trial offerings: ${names.join(", ")}.`
      : "Local scripted reply (no AI Gateway token). There are no active trial offerings.";
  return { type: "text" as const, text };
}

const usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

function finishReason(step: ReturnType<typeof scriptedStep>) {
  return {
    unified: step.type === "tool-call" ? "tool-calls" : "stop",
    raw: undefined,
  } as const;
}

const scriptedLocalModel: LanguageModelV4 = {
  specificationVersion: "v4",
  provider: "fillthemat",
  modelId: "scripted-local",
  supportedUrls: {},
  async doGenerate({ prompt }) {
    const step = scriptedStep(prompt);
    return {
      content: [step],
      finishReason: finishReason(step),
      usage,
      warnings: [],
    };
  },
  async doStream({ prompt }) {
    const step = scriptedStep(prompt);
    const parts: StreamPart[] =
      step.type === "tool-call"
        ? [step]
        : [
            { type: "text-start", id: "reply" },
            { type: "text-delta", id: "reply", delta: step.text },
            { type: "text-end", id: "reply" },
          ];
    parts.push({ type: "finish", finishReason: finishReason(step), usage });
    return {
      stream: new ReadableStream({
        start(controller) {
          for (const part of parts) controller.enqueue(part);
          controller.close();
        },
      }),
    };
  },
};
