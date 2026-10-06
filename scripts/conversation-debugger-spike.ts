// Compatibility probe: run with `bun scripts/conversation-debugger-spike.ts` (no cloud credentials).
import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import {
  propagateAttributes,
  setLangfuseTracerProvider,
  startActiveObservation,
} from "@langfuse/tracing";
import { LangfuseVercelAiSdkIntegration } from "@langfuse/vercel-ai-sdk";
import { context } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  generateText,
  isStepCount,
  registerTelemetry,
  simulateReadableStream,
  streamText,
  tool,
} from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
// @ts-expect-error Node's type-stripping ESM loader requires the .ts extension.
import { safeExporter } from "../src/lib/observability/safe-exporter.ts";

const spans: ReadableSpan[] = [];
const exporter: SpanExporter = {
  export(batch, callback) {
    spans.push(...batch);
    callback({ code: 0 });
  },
  shutdown: async () => {},
};
const processor = new LangfuseSpanProcessor({
  exporter: safeExporter(exporter),
  mediaUploadEnabled: false,
});
const manager = new AsyncLocalStorageContextManager().enable();
assert.equal(context.setGlobalContextManager(manager), true);
const provider = new NodeTracerProvider({ spanProcessors: [processor] });
setLangfuseTracerProvider(provider);
registerTelemetry(
  new LangfuseVercelAiSdkIntegration({
    tracer: provider.getTracer("conversation-debugger-spike"),
  }),
);

const usage = {
  inputTokens: {
    total: 10,
    noCache: 10,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 10, text: 10, reasoning: undefined },
};
async function run(sessionId: string) {
  let count = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      count++;
      return {
        content:
          count === 1
            ? [
                {
                  type: "tool-call" as const,
                  toolCallType: "function" as const,
                  toolCallId: `call-${sessionId}`,
                  toolName: "lookup",
                  input: '{"day":"Tuesday"}',
                },
              ]
            : [{ type: "text" as const, text: "Slots checked." }],
        finishReason: {
          unified: count === 1 ? ("tool-calls" as const) : ("stop" as const),
          raw: undefined,
        },
        usage,
        warnings: [],
      };
    },
  });
  return startActiveObservation("booking-chat.turn", async (root) => {
    const result = await propagateAttributes(
      {
        sessionId,
        traceName: "booking-chat.turn",
        metadata: { debugCapture: "true" },
      },
      () =>
        generateText({
          model,
          prompt: `Find Tuesday slots for ${sessionId}`,
          stopWhen: isStepCount(8),
          tools: {
            lookup: tool({
              inputSchema: z.object({ day: z.string() }),
              execute: async ({ day }) => ({ day, slots: ["10:00"] }),
            }),
          },
          telemetry: { functionId: "booking-agent" },
        }),
    );
    root.update({ output: result.text });
    assert.equal(result.steps.length, 2);
    return result;
  });
}
try {
  await Promise.all([run("session-A"), run("session-B")]);
  await processor.forceFlush();
  for (const sessionId of ["session-A", "session-B"]) {
    const roots = spans.filter(
      (s) =>
        s.name === "booking-chat.turn" &&
        s.attributes["session.id"] === sessionId,
    );
    assert.equal(roots.length, 1);
    const children = spans.filter(
      (s) => s.spanContext().traceId === roots[0].spanContext().traceId,
    );
    assert.equal(
      children.filter((s) => s.attributes["gen_ai.operation.name"] === "chat")
        .length,
      2,
    );
    assert.equal(
      children.filter(
        (s) => s.attributes["gen_ai.operation.name"] === "execute_tool",
      ).length,
      1,
    );
    const secondCall = children.find(
      (s) =>
        s.attributes["gen_ai.operation.name"] === "chat" &&
        String(s.attributes["gen_ai.input.messages"]).includes(
          "tool_call_response",
        ),
    );
    assert.ok(secondCall, "second call must include the first tool result");
    assert.equal(
      children.every((s) => s.attributes["session.id"] === sessionId),
      true,
    );
    console.log(`${sessionId}: 2 generations, 1 tool, context retained`);
  }
  // Streaming must retain its parent after the response object has been created.
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "text-start", id: "text-1" },
          { type: "text-delta", id: "text-1", delta: "Hello" },
          { type: "text-end", id: "text-1" },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: undefined },
            usage,
          },
        ],
      }),
    }),
  });
  let resolveStream: () => void = () => {};
  const streamFinished = new Promise<void>((resolve) => {
    resolveStream = resolve;
  });
  await propagateAttributes(
    {
      sessionId: "stream-session",
      traceName: "booking-chat.turn",
      metadata: { debugCapture: "true" },
    },
    () =>
      startActiveObservation(
        "booking-chat.turn",
        async (root) => {
          const result = streamText({
            model,
            prompt: "Hello",
            telemetry: { functionId: "booking-agent" },
          });
          // Mimic a Next response returning while its SSE drain and persistence continue.
          void Promise.resolve().then(async () => {
            assert.equal(await result.text, "Hello");
            root.update({
              output: "Hello",
              metadata: { persistenceOutcome: "complete" },
            });
            root.end();
            resolveStream();
          });
          return "response returned before stream completion";
        },
        { endOnExit: false },
      ),
  );
  await streamFinished;
  await processor.forceFlush();
  const streamingRoot = spans.find(
    (s) =>
      s.name === "booking-chat.turn" &&
      s.attributes["session.id"] === "stream-session",
  );
  assert.ok(streamingRoot);
  assert.equal(
    spans.filter(
      (s) =>
        s.spanContext().traceId === streamingRoot.spanContext().traceId &&
        s.attributes["gen_ai.operation.name"] === "chat",
    ).length,
    1,
  );
  console.log("streaming: generation attached to root");
  const before = spans.length;
  await generateText({
    model: new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: "text", text: "No trace" }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      }),
    }),
    prompt: "Non-debug WhatsApp or public chat",
    telemetry: { isEnabled: false },
  });
  await processor.forceFlush();
  assert.equal(spans.length, before);
  console.log("opted-out calls: no exported spans");

  // A deliberately bad synthetic turn followed by recovery in one session.
  for (const turn of ["stalled", "recovery"] as const) {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        calls++;
        return {
          content:
            turn === "recovery" && calls <= 2
              ? [
                  {
                    type: "tool-call" as const,
                    toolCallType: "function" as const,
                    toolCallId: `synthetic-call-${calls}`,
                    toolName:
                      calls === 1 ? "list_trial_offerings" : "list_trial_slots",
                    input:
                      calls === 1
                        ? '{"participantAge":5}'
                        : '{"offeringId":"00000000-0000-4000-8000-000000000005"}',
                  },
                ]
              : [
                  {
                    type: "text" as const,
                    text:
                      turn === "stalled"
                        ? "I'll check the slots for you."
                        : "Tuesday at 16:00 is available.",
                  },
                ],
          finishReason: {
            unified:
              turn === "recovery" && calls <= 2
                ? ("tool-calls" as const)
                : ("stop" as const),
            raw: undefined,
          },
          usage,
          warnings: [],
        };
      },
    });
    await propagateAttributes(
      {
        sessionId: "synthetic-tuesday-age-five",
        traceName: "booking-chat.turn",
        metadata: { debugCapture: "true" },
      },
      () =>
        startActiveObservation("booking-chat.turn", async (root) => {
          const prompt =
            turn === "stalled"
              ? "Are there Tuesday times for my five-year-old?"
              : "Did you find any Tuesday times?";
          const result = await generateText({
            model,
            prompt,
            stopWhen: isStepCount(8),
            tools: {
              list_trial_offerings: tool({
                inputSchema: z.object({
                  participantAge: z.number().optional(),
                }),
                execute: async () => ({
                  offerings: [
                    {
                      id: "00000000-0000-4000-8000-000000000005",
                      name: "Kids beginner trial",
                    },
                  ],
                }),
              }),
              list_trial_slots: tool({
                inputSchema: z.object({ offeringId: z.string().uuid() }),
                execute: async () => ({
                  slots: [{ day: "Tuesday", time: "16:00" }],
                }),
              }),
            },
            telemetry: { functionId: "booking-agent" },
          });
          root.update({ input: prompt, output: result.text });
        }),
    );
  }
  await processor.forceFlush();
  const turns = spans.filter(
    (s) =>
      s.name === "booking-chat.turn" &&
      s.attributes["session.id"] === "synthetic-tuesday-age-five",
  );
  assert.equal(turns.length, 2);
  assert.notEqual(
    turns[0].spanContext().traceId,
    turns[1].spanContext().traceId,
  );
  const toolsForTurn = (root: ReadableSpan) =>
    spans.filter(
      (s) =>
        s.spanContext().traceId === root.spanContext().traceId &&
        s.attributes["gen_ai.operation.name"] === "execute_tool",
    );
  assert.equal(toolsForTurn(turns[0]).length, 0);
  assert.deepEqual(
    toolsForTurn(turns[1]).map((s) => s.attributes["gen_ai.tool.name"]),
    ["list_trial_offerings", "list_trial_slots"],
  );
  console.log(
    "synthetic-tuesday-age-five: stalled turn (no tool) followed by recovery (slot lookup), 2 traces in 1 session",
  );
  const fixturePath =
    process.argv[2] === "--fixture" ? process.argv[3] : undefined;
  if (fixturePath) {
    const turnIds = new Set(turns.map((s) => s.spanContext().traceId));
    writeFileSync(
      fixturePath,
      `${JSON.stringify(
        {
          fixture: "local in-memory exporter, NOT Langfuse Cloud",
          sessionId: "synthetic-tuesday-age-five",
          spans: spans
            .filter((s) => turnIds.has(s.spanContext().traceId))
            .map((s) => ({
              name: s.name,
              traceId: s.spanContext().traceId,
              parentSpanId: s.parentSpanContext?.spanId ?? null,
              attributes: s.attributes,
            })),
        },
        null,
        2,
      )}\n`,
    );
  }
} finally {
  await processor.shutdown();
  manager.disable();
}
