import { isDefaultExportSpan, LangfuseSpanProcessor } from "@langfuse/otel";
import type { Attributes, AttributeValue, Context } from "@opentelemetry/api";
import type {
  ReadableSpan,
  Span,
  SpanExporter,
  SpanProcessor,
} from "@opentelemetry/sdk-trace-base";

/**
 * The span processor that exports traces to Langfuse, with email addresses
 * and phone numbers masked in everything a span exports.
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
  return new MaskingSpanProcessor(
    new LangfuseSpanProcessor({
      exporter,
      exportMode: exporter ? "immediate" : "batched",
      mediaUploadEnabled: false,
    }),
  );
}

// Langfuse's own `mask` option only covers its input, output and metadata
// attributes, not the AI SDK's gen_ai.* attributes, events or status
// messages. This masks every field of each span Langfuse will export, before
// Langfuse sees it.
class MaskingSpanProcessor implements SpanProcessor {
  constructor(private readonly langfuse: SpanProcessor) {}

  onStart(span: Span, parentContext: Context): void {
    this.langfuse.onStart(span, parentContext);
  }

  onEnd(span: ReadableSpan): void {
    if (isDefaultExportSpan(span)) {
      try {
        maskSpan(span);
      } catch {
        // Never export what couldn't be masked.
        console.error("tracing: masking failed, span dropped");
        return;
      }
    }
    this.langfuse.onEnd(span);
  }

  forceFlush(): Promise<void> {
    return this.langfuse.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.langfuse.shutdown();
  }
}

// An ended span can still be changed in place, which is how Langfuse applies
// its own masking too.
function maskSpan(span: ReadableSpan): void {
  (span as { name: string }).name = maskText(span.name);
  maskAttributes(span.attributes);
  for (const event of span.events) {
    event.name = maskText(event.name);
    maskAttributes(event.attributes);
  }
  for (const link of span.links) maskAttributes(link.attributes);
  if (span.status.message) span.status.message = maskText(span.status.message);
}

function maskAttributes(attributes: Attributes | undefined): void {
  if (!attributes) return;
  for (const [key, value] of Object.entries(attributes)) {
    attributes[key] = maskAttributeValue(value);
  }
}

function maskAttributeValue(
  value: AttributeValue | undefined,
): AttributeValue | undefined {
  if (typeof value === "string") return maskString(value);
  if (Array.isArray(value)) {
    return value.map((item) =>
      typeof item === "string" ? maskString(item) : item,
    ) as AttributeValue;
  }
  return value;
}

// Attributes often hold JSON (messages, tool calls and results). Masking the
// decoded strings also catches a number that the encoding glues to a letter,
// as in "\n07700 900123".
function maskString(value: string): string {
  const start = value.trimStart()[0];
  if (start === "{" || start === "[") {
    try {
      return JSON.stringify(maskJson(JSON.parse(value)));
    } catch {
      // Not JSON after all.
    }
  }
  return maskText(value);
}

function maskJson(value: unknown): unknown {
  if (typeof value === "string") return maskText(value);
  if (typeof value === "number") {
    return maskText(String(value)) === String(value) ? value : "[phone]";
  }
  if (Array.isArray(value)) return value.map(maskJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        maskText(key),
        maskJson(item),
      ]),
    );
  }
  return value;
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi;
// An optional +country code and (area code), then groups of digits joined by
// single spaces, dots or hyphens. It must not touch a letter, digit, + or -,
// nor be followed by ":" as in a time.
const PHONE =
  /(?<![\w+-])(?:\+\d{1,3}[ .-]?)?(?:\(\d{1,5}\)[ .-]?)?\d{2,15}(?:[ .-]\d{2,15}){0,5}(?![\w:-])/g;

// Ages, prices, dates and times have too few digits to count as a phone
// number; 9 to 15 do.
function maskText(text: string): string {
  return text.replace(EMAIL, "[email]").replace(PHONE, (match) => {
    const digits = match.replace(/\D/g, "").length;
    return digits >= 9 && digits <= 15 ? "[phone]" : match;
  });
}
