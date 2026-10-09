import { trace } from "@opentelemetry/api";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { describe, expect, it } from "vitest";
import { registerTracing } from "./register";

describe("tracing without both Langfuse keys", () => {
  it.each([
    { keys: "no Langfuse keys", env: {} },
    { keys: "only the public key", env: { LANGFUSE_PUBLIC_KEY: "pk-lf-test" } },
    { keys: "only the secret key", env: { LANGFUSE_SECRET_KEY: "sk-lf-test" } },
  ])(
    "registers nothing with $keys, so no span is recorded or exported",
    ({ env }) => {
      const exporter = new InMemorySpanExporter();

      expect(registerTracing({ env, exporter })).toBeUndefined();

      expect(globalThis.AI_SDK_TELEMETRY_INTEGRATIONS ?? []).toEqual([]);
      const span = trace.getTracer("gen_ai").startSpan("chat scripted-local");
      span.end();
      expect(span.isRecording()).toBe(false);
      expect(exporter.getFinishedSpans()).toEqual([]);
    },
  );
});
