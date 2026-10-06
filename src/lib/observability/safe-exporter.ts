import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";

// This is a last-mile allowlist: LangfuseSpanProcessor.mask does not touch gen_ai.*.
// Keep this ahead of the network exporter, not in a UI or tool callback.
const scalarKeys = new Set([
  "langfuse.internal.is_app_root",
  "langfuse.observation.type",
  "langfuse.trace.name",
  "langfuse.observation.level",
  "session.id",
  "user.id",
  "gen_ai.operation.name",
  "gen_ai.provider.name",
  "gen_ai.request.model",
  "gen_ai.response.model",
  "gen_ai.response.id",
  "gen_ai.response.finish_reasons",
  "gen_ai.request.temperature",
  "gen_ai.request.max_tokens",
  "gen_ai.usage.input_tokens",
  "gen_ai.usage.output_tokens",
  "gen_ai.client.operation.duration",
  "gen_ai.client.operation.time_to_first_chunk",
  "gen_ai.execute_tool.duration",
  "gen_ai.tool.name",
  "gen_ai.tool.call.id",
  "gen_ai.tool.type",
]);
const contentKeys = new Set([
  "langfuse.observation.input",
  "langfuse.observation.output",
  "langfuse.observation.metadata",
  "langfuse.trace.input",
  "langfuse.trace.output",
  "langfuse.trace.metadata",
  "gen_ai.system_instructions",
  "gen_ai.input.messages",
  "gen_ai.output.messages",
  "gen_ai.tool.definitions",
  "gen_ai.tool.call.arguments",
  "gen_ai.tool.call.result",
]);
const forbiddenKey =
  /reasoning|chain.of.thought|thinking|secret|token|password|cookie|authorization|headers?|provider.metadata|email|phone|contact|participant.?name|guardian.?name|parent.?name|first.?name|last.?name|full.?name|address|error|exception|stack/i;
const email = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const phone = /(?<!\w)(?:\+?\d[\d\s().-]{7,}\d)(?!\w)/g;
const bearer = /\b(?:Bearer\s+|sk[-_][\w-]{8,})[\w.=-]+/gi;
const MAX_ATTRIBUTE = 12_000;
const MAX_TEXT = 2_000;

function clean(value: unknown, depth = 0): unknown {
  if (depth > 12) return "[depth limit]";
  if (typeof value === "string") {
    // Canonical app/trace/request UUIDs are correlation keys, not phone numbers.
    if (/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value))
      return value;
    const masked = value
      .replace(email, "[email masked]")
      .replace(phone, "[phone masked]")
      .replace(bearer, "[credential masked]");
    return masked.length > MAX_TEXT
      ? `${masked.slice(0, MAX_TEXT)}[truncated]`
      : masked;
  }
  if (Array.isArray(value))
    return value
      .filter(
        (item) =>
          !(
            item &&
            typeof item === "object" &&
            "type" in item &&
            /reasoning|thinking/i.test(String(item.type))
          ),
      )
      .slice(0, 50)
      .map((item) => clean(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 50)
        .filter(([key]) => !forbiddenKey.test(key))
        .map(([key, item]) => [key, clean(item, depth + 1)]),
    );
  }
  return typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
    ? value
    : undefined;
}

export function sanitizeCapture(value: unknown): string {
  try {
    if (typeof value === "string" && value.length > 64_000)
      return "[oversize capture omitted]";
    const decoded =
      typeof value === "string" && /^(\[|\{)/.test(value.trim())
        ? JSON.parse(value)
        : value;
    const output = clean(decoded);
    const text = typeof output === "string" ? output : JSON.stringify(output);
    return text.length > MAX_ATTRIBUTE
      ? `${text.slice(0, MAX_ATTRIBUTE)}[truncated]`
      : text;
  } catch {
    // Malformed JSON should not bypass recursive key filtering.
    return "[unparseable capture omitted]";
  }
}

export function isDebugSpan(span: ReadableSpan): boolean {
  if (
    !span.attributes["session.id"] ||
    span.attributes["langfuse.trace.name"] !== "booking-chat.turn"
  )
    return false;
  return (
    span.name === "booking-chat.turn" ||
    ["chat", "execute_tool", "agent_step", "invoke_agent"].includes(
      String(span.attributes["gen_ai.operation.name"]),
    )
  );
}

export function safeSpan(span: ReadableSpan): ReadableSpan {
  const attributes: Record<
    string,
    string | number | boolean | (string | number | boolean)[]
  > = {};
  const operation = span.attributes["gen_ai.operation.name"];
  for (const [key, value] of Object.entries(span.attributes)) {
    if (forbiddenKey.test(key)) continue;
    // The aggregate agent span repeats history, output and child usage. Its children
    // carry the per-call evidence; the turn span carries only this turn's IO.
    if (
      operation === "invoke_agent" &&
      (contentKeys.has(key) || key.startsWith("gen_ai.usage."))
    )
      continue;
    if (contentKeys.has(key)) attributes[key] = sanitizeCapture(value);
    else if (scalarKeys.has(key) && value !== undefined && value !== null) {
      if (typeof value === "string") {
        attributes[key] =
          key === "session.id" && /^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(value)
            ? value
            : sanitizeCapture(value);
      } else if (typeof value === "number" || typeof value === "boolean")
        attributes[key] = value;
      else if (Array.isArray(value))
        attributes[key] = value.map((item) => sanitizeCapture(item));
    }
  }
  if (span.status.code === 2) {
    attributes["langfuse.observation.level"] = "ERROR";
    if (!attributes["langfuse.observation.output"])
      attributes["langfuse.observation.output"] =
        "[execution failed; error details omitted]";
  }
  return new Proxy(span, {
    get(target, property) {
      if (property === "name") {
        const operation = attributes["gen_ai.operation.name"];
        if (target.name === "booking-chat.turn") return target.name;
        if (operation === "execute_tool")
          return `execute_tool ${String(attributes["gen_ai.tool.name"] ?? "unknown").slice(0, 64)}`;
        return String(operation ?? "booking-chat.observation");
      }
      if (property === "instrumentationScope")
        return { name: "fillthemat-conversation-debugger", version: "1" };
      if (property === "attributes") return attributes;
      if (property === "events" || property === "links") return [];
      if (property === "status") return { code: target.status.code }; // error messages may contain secrets
      if (property === "resource")
        return new Proxy(target.resource, {
          get(resource, key) {
            if (key === "attributes")
              return { "service.name": "fillthemat-conversation-debugger" };
            return Reflect.get(resource, key);
          },
        });
      return Reflect.get(target, property);
    },
  });
}

export function safeExporter(network: SpanExporter): SpanExporter {
  return {
    export(spans, callback) {
      // Never send unexpected spans, even when another library auto-instruments itself.
      const accepted = spans.filter(isDebugSpan);
      if (!accepted.length) return callback({ code: 0 });
      try {
        network.export(accepted.map(safeSpan), callback);
      } catch {
        console.error(JSON.stringify({ event: "chat_debug_export_failed" }));
        callback({ code: 1 });
      }
    },
    forceFlush: () => network.forceFlush?.() ?? Promise.resolve(),
    shutdown: () => network.shutdown(),
  };
}
