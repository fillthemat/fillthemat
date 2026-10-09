import { LangfuseVercelAiSdkIntegration } from "@langfuse/vercel-ai-sdk";
import { context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { ExportResultCode } from "@opentelemetry/core";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import { registerTelemetry } from "ai";
import { afterEach, beforeEach, vi } from "vitest";
import { createTraceSpanProcessor } from "@/lib/tracing/span-processor";

// Integration tests trace the way production does when Langfuse keys are set:
// the production span processor and the AI SDK's Langfuse integration. Spans
// are exported into memory instead of to Langfuse. Installed once per test
// process, because the AI SDK integration stays bound to the first provider.

type TestTracing = {
  exporter: InMemorySpanExporter;
  provider: BasicTracerProvider;
};

const INSTALLED = Symbol.for("fillthemat.testTracing");
const registry = globalThis as typeof globalThis & {
  [INSTALLED]?: TestTracing;
};

function install(): TestTracing {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [createTraceSpanProcessor({ exporter })],
  });
  context.setGlobalContextManager(
    new AsyncLocalStorageContextManager().enable(),
  );
  trace.setGlobalTracerProvider(provider);
  registerTelemetry(new LangfuseVercelAiSdkIntegration());
  return { exporter, provider };
}

registry[INSTALLED] ??= install();
const tracing: TestTracing = registry[INSTALLED];

/** Every span exported during the current test, once in-flight exports finish. */
export async function exportedSpans(): Promise<ReadableSpan[]> {
  await tracing.provider.forceFlush();
  return tracing.exporter.getFinishedSpans();
}

const OBSERVATION_METADATA = "langfuse.observation.metadata.";

/** The span every other span in its trace descends from. */
export function isRoot(span: ReadableSpan) {
  return !span.parentSpanContext;
}

/**
 * The traces exported during the current test, read the way Langfuse reads
 * them: trace-level fields come from the trace's root span.
 */
export async function exportedTraces() {
  const spans = await exportedSpans();
  const traceIds = [
    ...new Set(spans.map((span) => span.spanContext().traceId)),
  ];
  return traceIds.map((traceId) => {
    const root = spans.find(
      (span) => span.spanContext().traceId === traceId && isRoot(span),
    );
    const attributes = root?.attributes ?? {};
    return {
      sessionId: attributes["session.id"],
      userId: attributes["user.id"],
      tags: attributes["langfuse.trace.tags"],
      name: attributes["langfuse.trace.name"],
      input: attributes["langfuse.observation.input"],
      output: attributes["langfuse.observation.output"],
      level: attributes["langfuse.observation.level"],
      statusMessage: attributes["langfuse.observation.status_message"],
      metadata: Object.fromEntries(
        Object.entries(attributes)
          .filter(([key]) => key.startsWith(OBSERVATION_METADATA))
          .map(([key, value]) => [
            key.slice(OBSERVATION_METADATA.length),
            value,
          ]),
      ),
    };
  });
}

let langfuseOutage: Array<{ mockRestore(): void }> = [];

/** Makes exporting spans fail for the rest of the test, as if Langfuse were down. */
export function failSpanExports() {
  const unreachable = new Error("Langfuse is unreachable");
  langfuseOutage = [
    vi
      .spyOn(tracing.exporter, "export")
      .mockImplementation((_spans, done) =>
        done({ code: ExportResultCode.FAILED, error: unreachable }),
      ),
    vi.spyOn(tracing.exporter, "forceFlush").mockRejectedValue(unreachable),
  ];
}

beforeEach(async () => {
  await tracing.provider.forceFlush().catch(() => {});
  tracing.exporter.reset();
});

afterEach(() => {
  for (const spy of langfuseOutage) spy.mockRestore();
  langfuseOutage = [];
});
