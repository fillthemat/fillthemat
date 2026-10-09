import { LangfuseSpanProcessor } from "@langfuse/otel";
import type {
  SpanExporter,
  SpanProcessor,
} from "@opentelemetry/sdk-trace-base";

/**
 * The span processor that exports traces to Langfuse.
 *
 * Production passes no exporter: spans are batched and sent to Langfuse over
 * OTLP, and each turn flushes them. Tests pass an in-memory exporter, and each
 * span is exported as soon as it ends.
 */
export function createTraceSpanProcessor({
  exporter,
}: {
  exporter?: SpanExporter;
} = {}): SpanProcessor {
  return new LangfuseSpanProcessor({
    exporter,
    exportMode: exporter ? "immediate" : "batched",
    mediaUploadEnabled: false,
  });
}
