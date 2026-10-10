import { SpanStatusCode } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { describe, expect, it } from "vitest";
import { createTraceSpanProcessor } from "./span-processor";

// Spans shaped like the AI SDK's (gen_ai.* attributes), which Langfuse exports.
async function exportedToLangfuse(
  record: (tracer: ReturnType<BasicTracerProvider["getTracer"]>) => void,
) {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [createTraceSpanProcessor({ exporter })],
  });
  record(provider.getTracer("gen_ai"));
  await provider.forceFlush();
  return exporter.getFinishedSpans();
}

describe("the span processor that exports to Langfuse", () => {
  it("masks nested JSON-looking text without reparsing or changing its formatting", async () => {
    const input = JSON.stringify({ text: '{"email": "ana@example.com"}' });
    expect(await exportedText(input)).toBe(
      JSON.stringify({ text: '{"email": "[email]"}' }),
    );
  });

  it("masks email addresses and phone numbers in a span's name, attributes, events, links and status", async () => {
    const [span] = await exportedToLangfuse((tracer) => {
      const earlier = tracer.startSpan("earlier");
      earlier.end();
      const tool = tracer.startSpan("execute_tool email ana@example.com", {
        attributes: {
          "gen_ai.operation.name": "execute_tool",
          "gen_ai.tool.call.arguments": JSON.stringify({
            participantName: "Ana",
            participantAge: 8,
            statedNeed: "Call +44 7700 900123",
          }),
        },
        links: [
          {
            context: earlier.spanContext(),
            attributes: { note: "from ana@example.com" },
          },
        ],
      });
      tool.recordException(new Error("No slot for 650-555-1234"));
      tool.setStatus({
        code: SpanStatusCode.ERROR,
        message: "No slot for 650-555-1234",
      });
      tool.end();
    }).then((spans) => spans.filter(({ name }) => name !== "earlier"));

    expect(span?.name).toBe("execute_tool email [email]");
    expect(
      JSON.parse(String(span?.attributes["gen_ai.tool.call.arguments"])),
    ).toEqual({
      participantName: "Ana",
      participantAge: 8,
      statedNeed: "Call [phone]",
    });
    expect(span?.links[0]?.attributes).toEqual({ note: "from [email]" });
    expect(span?.events[0]?.attributes?.["exception.message"]).toBe(
      "No slot for [phone]",
    );
    expect(span?.events[0]?.attributes?.["exception.stacktrace"]).toMatch(
      /^Error: No slot for \[phone\]\n/,
    );
    expect(span?.status.message).toBe("No slot for [phone]");
  });

  it("leaves ids, dates, times, ages and prices alone", async () => {
    const reply =
      "Kids BJJ (ages 5-12, £45) is on 2026-10-07 at 18:00 and 6:30 PM. " +
      "Offering 3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d, booked at 2026-10-05T12:00:00.000Z.";

    const [span] = await exportedToLangfuse((tracer) => {
      tracer
        .startSpan("chat scripted-local", {
          attributes: { "gen_ai.output.messages": reply },
        })
        .end();
    });

    expect(span?.attributes["gen_ai.output.messages"]).toBe(reply);
  });

  it.each([
    {
      number: "written as 3 and 4 digits",
      text: "Ana's dad is on 555-0142 most evenings.",
      masked: "Ana's dad is on [phone] most evenings.",
    },
    {
      number: "written as 4 and 4 digits",
      text: "Or try 9123 4567 instead.",
      masked: "Or try [phone] instead.",
    },
    {
      number: "with a country code",
      text: "From abroad it's +1 555 0142.",
      masked: "From abroad it's [phone].",
    },
    {
      number: "in one run, after phone wording",
      text: "Text me on 91234567 after six.",
      masked: "Text me on [phone] after six.",
    },
    {
      number: "in pairs, after phone wording",
      text: "Mobile: 12 34 56 78",
      masked: "Mobile: [phone]",
    },
    {
      number: "in other groups, after phone wording",
      text: "My phone number is 555 01 42, or call 123 45 678.",
      masked: "My phone number is [phone], or call [phone].",
    },
    {
      number: "after a tel: prefix",
      text: "tel:5550142",
      masked: "tel:[phone]",
    },
    {
      number: "after WhatsApp",
      text: "WhatsApp me at 5550142.",
      masked: "WhatsApp me at [phone].",
    },
  ])("masks a 7- or 8-digit phone number $number", async ({ text, masked }) => {
    expect(await exportedText(text)).toBe(masked);
  });

  it.each([
    { what: "an ISO timestamp", text: "booked at 2026-10-05T12:00:00.000Z" },
    { what: "a date and time", text: "on 2026-10-09 11:27" },
    { what: "a date with slashes", text: "on 09/10/2026" },
    { what: "a date with dots", text: "on 09.10.2026" },
    { what: "a date after phone wording", text: "Call us on 2026-10-09." },
    { what: "clock times", text: "at 18:00 or 6:30 PM" },
    { what: "a range of years", text: "the 2025-2026 season" },
    {
      what: "opening hours after phone wording",
      text: "Call between 0900-1700, Monday to Friday.",
    },
    { what: "a range of times with dots", text: "Text us 18.00-19.00." },
    { what: "an age", text: "My daughter is age 8." },
    { what: "an age range", text: "Ages 5-12" },
    { what: "a price", text: "£45 a month" },
    { what: "a price with decimals", text: "$1,200.00 a year" },
    { what: "a price range", text: "$500-1000 a year" },
    { what: "a large number", text: "1 200 000 views" },
    { what: "a count", text: "5 6 7 8 9 10" },
    { what: "an id of digits", text: "Order 91234567 shipped." },
    { what: "a UUID of digits", text: "12345678-1234-1234-1234-123456789012" },
    {
      what: "a wamid",
      text: "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQTJGQjc5RTQ3NjI3MDE3NUE1RQA=",
    },
    { what: "a version", text: "v21.0" },
  ])("leaves $what alone", async ({ text }) => {
    expect(await exportedText(text)).toBe(text);
  });
});

// The text as Langfuse receives it in a model call's output.
async function exportedText(text: string) {
  const [span] = await exportedToLangfuse((tracer) => {
    tracer
      .startSpan("chat scripted-local", {
        attributes: { "gen_ai.output.messages": text },
      })
      .end();
  });
  return span?.attributes["gen_ai.output.messages"];
}
