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
});
