import { LangfuseVercelAiSdkIntegration } from "@langfuse/vercel-ai-sdk";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { registerTelemetry } from "ai";
import { createTraceSpanProcessor } from "./span-processor";

type Registration = { provider?: NodeTracerProvider };

const REGISTERED = Symbol.for("fillthemat.tracing.registered");
const registry = globalThis as typeof globalThis & {
  [REGISTERED]?: Registration;
};

/**
 * Traces turns to Langfuse where both Langfuse keys are set: registers the
 * tracer provider, with the span processor that masks and exports spans, and
 * the AI SDK's Langfuse integration. Without both keys (local dev, CI) it
 * registers nothing, so nothing is recorded or exported.
 *
 * Registers once per process, and never throws. Returns the registered
 * provider, if any.
 */
export function registerTracing({
  env = process.env,
  exporter,
}: {
  env?: Record<string, string | undefined>;
  /** Where spans go instead of Langfuse, e.g. memory in tests. */
  exporter?: SpanExporter;
} = {}): NodeTracerProvider | undefined {
  if (!env.LANGFUSE_PUBLIC_KEY || !env.LANGFUSE_SECRET_KEY) return undefined;
  // Registering the AI SDK integration twice would record every span twice,
  // so a failed attempt isn't retried either.
  const registered = registry[REGISTERED];
  if (registered) return registered.provider;
  const registration: Registration = {};
  registry[REGISTERED] = registration;
  try {
    const provider = new NodeTracerProvider({
      spanProcessors: [createTraceSpanProcessor({ exporter })],
    });
    // Also installs the async context that nests a turn's spans under it.
    provider.register();
    registerTelemetry(new LangfuseVercelAiSdkIntegration());
    registration.provider = provider;
  } catch (error) {
    // Next fails every request if instrumentation throws. Replies matter
    // more than their traces.
    console.error(
      "tracing: setup failed",
      error instanceof Error ? error.name : "unknown",
    );
  }
  return registration.provider;
}
