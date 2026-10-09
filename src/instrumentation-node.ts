import { LangfuseVercelAiSdkIntegration } from "@langfuse/vercel-ai-sdk";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { registerTelemetry } from "ai";
import { createTraceSpanProcessor } from "@/lib/tracing/span-processor";

// Turns are traced only where Langfuse keys are configured. Without them
// (local dev, CI) nothing is registered, so nothing is recorded or exported.
const REGISTERED = Symbol.for("fillthemat.tracing.registered");
const registry = globalThis as typeof globalThis & { [REGISTERED]?: true };

if (
  process.env.LANGFUSE_PUBLIC_KEY &&
  process.env.LANGFUSE_SECRET_KEY &&
  !registry[REGISTERED]
) {
  // Registering the AI SDK integration twice would record every span twice.
  registry[REGISTERED] = true;
  try {
    new NodeSDK({ spanProcessors: [createTraceSpanProcessor()] }).start();
    registerTelemetry(new LangfuseVercelAiSdkIntegration());
  } catch (error) {
    // Next fails every request if instrumentation throws. Replies matter
    // more than their traces.
    console.error(
      "tracing: setup failed",
      error instanceof Error ? error.name : "unknown",
    );
  }
}
