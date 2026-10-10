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
 * Spans are batched until a web chat turn, or a WhatsApp worker run, exports
 * them. Production passes no exporter: batches are sent to Langfuse over OTLP.
 * Tests pass an in-memory exporter, which receives spans exactly when
 * Langfuse would.
 */
export function createTraceSpanProcessor({
  exporter,
}: {
  exporter?: SpanExporter;
} = {}): SpanProcessor {
  return new MaskingSpanProcessor(
    new LangfuseSpanProcessor({
      exporter,
      exportMode: "batched",
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
      return JSON.stringify(maskContactFields(JSON.parse(value)));
    } catch {
      // Not JSON after all.
    }
  }
  return maskText(value);
}

/** ADR-0001 masking for decoded contact fields, without reparsing nested text. */
export function maskContactFields(value: unknown): unknown {
  if (typeof value === "string") return maskText(value);
  if (typeof value === "number") {
    return maskText(String(value)) === String(value) ? value : "[phone]";
  }
  if (Array.isArray(value)) return value.map(maskContactFields);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        maskText(key),
        maskContactFields(item),
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

function maskText(text: string): string {
  const withoutEmails = text.replace(EMAIL, "[email]");
  return withoutEmails.replace(PHONE, (match: string, offset: number) => {
    // Enough of the text before the number to hold any phone wording.
    const before = withoutEmails.slice(Math.max(0, offset - 80), offset);
    return isPhoneNumber(match, before) ? "[phone]" : match;
  });
}

// Ages, prices, dates and times have too few digits to be a phone number with
// its area code; 9 to 15 do. A number of 7 or 8 digits, as dialled without
// the area code, is one only if it's written like one or follows phone
// wording, and never if it reads as a price, a date or a range.
function isPhoneNumber(match: string, before: string): boolean {
  const groups = match.match(/\d+/g) ?? [];
  const digits = groups.join("").length;
  if (digits >= 9 && digits <= 15) return true;
  if (digits < 7 || digits > 8) return false;
  if (CURRENCY_BEFORE.test(before) || readsAsDateOrRange(groups)) return false;
  return LOCAL_NUMBER.test(match) || PHONE_WORDING_BEFORE.test(before);
}

const CURRENCY_BEFORE = /[$£€¥₹] ?$/;
// A +country code or an (area code), or 3 or 4 digits then 4, as in
// "555-0142" or "9123 4567".
const LOCAL_NUMBER = /^[+(]|^\d{3,4}[ -]\d{4}$/;
// Phone wording, then at most three words on the same line, as in "call me
// on", "my phone number is" or "WhatsApp:".
const PHONE_WORDING_BEFORE =
  /\b(?:(?:tele|cell)?phone[ds]?|tel|mobile|cell|call(?:s|ed|ing)?|text(?:s|ed|ing)?|whats ?app|numbers?)\b[^\w\n]*(?:[a-z']+[^\w\n]+){0,3}$/i;

// A date (2026-10-09, 09.10.2026), or a range of years (2025-2026) or of
// clock times (0900-1700, 18.00-19.00).
function readsAsDateOrRange(groups: string[]): boolean {
  const shape = groups.map((group) => group.length).join("-");
  if (shape === "4-2-2" || shape === "2-2-4") return true;
  if (shape === "4-4") {
    return groups.every(isYear) || groups.every(isClockTime);
  }
  if (shape === "2-2-2-2") {
    const [startHour, startMinute, endHour, endMinute] = groups;
    return (
      isClockTime(`${startHour}${startMinute}`) &&
      isClockTime(`${endHour}${endMinute}`)
    );
  }
  return false;
}

const isYear = (digits: string) => /^(?:19|20)\d\d$/.test(digits);

const isClockTime = (hhmm: string) =>
  Number(hhmm.slice(0, 2)) < 24 && Number(hhmm.slice(2)) < 60;
