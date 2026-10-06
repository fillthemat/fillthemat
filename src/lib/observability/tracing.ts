import "server-only";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { setLangfuseTracerProvider } from "@langfuse/tracing";
import { LangfuseVercelAiSdkIntegration } from "@langfuse/vercel-ai-sdk";
import { context } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { captureConfigured } from "./debug-context";
import { isDebugSpan, safeExporter } from "./safe-exporter";

type CaptureRuntime = {
  processor: LangfuseSpanProcessor;
  provider: NodeTracerProvider;
  integration: LangfuseVercelAiSdkIntegration;
};
const runtimeKey = Symbol.for("fillthemat.conversation-debugger.runtime");

function cloudUrl(): URL | null {
  try {
    const url = new URL(process.env.LANGFUSE_BASE_URL ?? "");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      ![
        "cloud.langfuse.com",
        "us.cloud.langfuse.com",
        "jp.cloud.langfuse.com",
        "hipaa.cloud.langfuse.com",
      ].includes(url.hostname)
    )
      return null;
    return url;
  } catch {
    return null;
  }
}

export function sessionUrl(conversationId: string): string | null {
  const origin = cloudUrl();
  const project = process.env.LANGFUSE_PROJECT_ID;
  if (
    !origin ||
    !project ||
    !/^[a-zA-Z0-9_-]{8,64}$/.test(project) ||
    !/^[a-f0-9-]{36}$/i.test(conversationId)
  )
    return null;
  return new URL(
    `/project/${project}/sessions/${conversationId}`,
    origin,
  ).toString();
}

export function captureRuntime(): CaptureRuntime | null {
  if (
    !captureConfigured() ||
    !cloudUrl() ||
    !sessionUrl("00000000-0000-0000-0000-000000000000")
  )
    return null;
  const global = globalThis as typeof globalThis & {
    [runtimeKey]?: CaptureRuntime;
  };
  if (global[runtimeKey]) {
    // Next's instrumentation and route bundles can have distinct module instances.
    setLangfuseTracerProvider(global[runtimeKey].provider);
    return global[runtimeKey];
  }
  const origin = cloudUrl();
  if (!origin) return null;
  const processor = new LangfuseSpanProcessor({
    exporter: safeExporter(
      new OTLPTraceExporter({
        url: new URL("/api/public/otel/v1/traces", origin).toString(),
        headers: {
          Authorization: `Basic ${Buffer.from(`${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`).toString("base64")}`,
        },
        timeoutMillis: 2000,
      }),
    ),
    mediaUploadEnabled: false,
    exportMode: "batched",
    shouldExportSpan: ({ otelSpan }) => isDebugSpan(otelSpan),
    environment: process.env.VERCEL_ENV ?? "local",
    release: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
  });
  // Install async context only if Next has not already installed one.
  const manager = new AsyncLocalStorageContextManager().enable();
  if (!context.setGlobalContextManager(manager)) manager.disable();
  const provider = new NodeTracerProvider({ spanProcessors: [processor] });
  // Isolated provider: do not replace Next.js's global OTel tracer provider.
  setLangfuseTracerProvider(provider);
  const runtime = {
    processor,
    provider,
    integration: new LangfuseVercelAiSdkIntegration({
      tracer: provider.getTracer("fillthemat-booking-debugger"),
    }),
  };
  global[runtimeKey] = runtime;
  return runtime;
}

export async function flushCapture() {
  const runtime = captureRuntime();
  if (!runtime) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      runtime.processor.forceFlush(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("flush_timeout")), 3000);
      }),
    ]);
  } catch {
    console.error(JSON.stringify({ event: "chat_debug_export_failed" }));
  } finally {
    if (timer) clearTimeout(timer);
  }
}
