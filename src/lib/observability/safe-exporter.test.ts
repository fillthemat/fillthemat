import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { describe, it } from "vitest";
import { safeExporter } from "./safe-exporter";

describe("Langfuse export boundary", () => {
  it("reports exporter failure without throwing into the chat", () => {
    const exporter = safeExporter({
      export() {
        throw new Error("SECRET_EXPORT_ERROR");
      },
      shutdown: async () => {},
    });
    let result: number | undefined;
    exporter.export(
      [
        {
          name: "booking-chat.turn",
          attributes: {
            "session.id": "test",
            "langfuse.trace.name": "booking-chat.turn",
          },
          status: { code: 0 },
          resource: { attributes: {} },
        } as unknown as ReadableSpan,
      ],
      ({ code }) => {
        result = code;
      },
    );
    assert.equal(result, 1);
  });

  it("strips forbidden fields from the real OTLP HTTP request body", async () => {
    const payloads: Buffer[] = [];
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      payloads.push(Buffer.concat(chunks));
      res.writeHead(200).end();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const exporter = new OTLPTraceExporter({
      url: `http://127.0.0.1:${address.port}/v1/traces`,
      timeoutMillis: 2000,
    });
    const provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(safeExporter(exporter))],
    });
    try {
      const span = provider.getTracer("synthetic").startSpan("chat synthetic", {
        attributes: {
          "session.id": "synthetic-session",
          "langfuse.trace.name": "booking-chat.turn",
          "gen_ai.operation.name": "chat",
          "gen_ai.request.model": "mock-model",
          "gen_ai.input.messages": JSON.stringify([
            {
              role: "user",
              parts: [
                {
                  type: "text",
                  content: "Email test@example.com, phone +1 (415) 555-0123",
                },
                { type: "reasoning", content: "SECRET_REASONING" },
              ],
            },
          ]),
          "gen_ai.response.providerMetadata": "SECRET_PROVIDER",
          "langfuse.observation.metadata": JSON.stringify({
            participantName: "SECRET_NAME",
            safe: "Tuesday",
          }),
        },
      });
      span.recordException(new Error("SECRET_EXCEPTION"));
      span.end();
      await provider.forceFlush();
      assert.ok(payloads.length > 0);
      const bytes = Buffer.concat(payloads).toString("utf8");
      for (const secret of [
        "test@example.com",
        "415",
        "SECRET_REASONING",
        "SECRET_PROVIDER",
        "SECRET_NAME",
        "SECRET_EXCEPTION",
      ]) {
        assert.equal(bytes.includes(secret), false, secret);
      }
      assert.match(bytes, /Tuesday/);
    } finally {
      await provider.shutdown();
      server.close();
    }
  });

  it("drops unrelated spans and strips nested sensitive data from the actual delegate payload", async () => {
    let batch: ReadableSpan[] = [];
    const delegate: SpanExporter = {
      export(spans, callback) {
        batch = spans;
        callback({ code: 0 });
      },
      shutdown: async () => {},
    };
    const exportSafe = safeExporter(delegate);
    const span = {
      name: "chat synthetic",
      attributes: {
        "session.id": "session-id",
        "langfuse.trace.name": "booking-chat.turn",
        "gen_ai.operation.name": "chat",
        "gen_ai.input.messages": JSON.stringify([
          {
            role: "user",
            parts: [
              {
                type: "text",
                content: "Call me at +1 (415) 555-0123 or test@example.com",
              },
              { type: "reasoning", content: "private thoughts" },
            ],
          },
        ]),
        "gen_ai.tool.call.result": JSON.stringify({
          slots: ["Tuesday"],
          nested: {
            authorization: "Bearer secret",
            phone: "555-555-5555",
            participantName: "TEST_REAL_NAME",
            error: "SECRET_ERROR",
          },
        }),
        "gen_ai.response.providerMetadata": "SECRET_PROVIDER",
        "exception.message": "SECRET_EXCEPTION",
        "gen_ai.tool.name": "list_trial_slots",
      },
      events: [
        {
          name: "exception",
          attributes: { "exception.message": "SECRET_EVENT" },
        },
      ],
      links: [{ attributes: { token: "SECRET_LINK" } }],
      status: { code: 2, message: "SECRET_STATUS" },
      resource: { attributes: { "process.command_args": "SECRET_PROCESS" } },
    } as unknown as ReadableSpan;
    exportSafe.export(
      [span, { ...span, attributes: {} } as ReadableSpan],
      () => {},
    );
    assert.equal(batch.length, 1);
    const serialized = JSON.stringify({
      attrs: batch[0].attributes,
      events: batch[0].events,
      links: batch[0].links,
      status: batch[0].status,
      resource: batch[0].resource.attributes,
    });
    for (const secret of [
      "private thoughts",
      "test@example.com",
      "415",
      "Bearer",
      "SECRET_PROVIDER",
      "SECRET_ERROR",
      "TEST_REAL_NAME",
      "SECRET_EXCEPTION",
      "SECRET_EVENT",
      "SECRET_LINK",
      "SECRET_STATUS",
      "SECRET_PROCESS",
    ]) {
      assert.equal(serialized.includes(secret), false, secret);
    }
    assert.match(serialized, /list_trial_slots/);
    assert.match(serialized, /Tuesday/);
    assert.match(serialized, /execution failed; error details omitted/);
  });
});
