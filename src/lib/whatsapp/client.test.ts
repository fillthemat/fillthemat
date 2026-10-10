import { describe, expect, it } from "vitest";
import {
  sendWhatsAppInteractive,
  sendWhatsAppTemplate,
  sendWhatsAppText,
  sendWhatsAppTypingIndicator,
  WHATSAPP_WINDOW_CLOSED_CODE,
} from "./client";

describe("WhatsApp Graph sends", () => {
  it.each([
    {
      response: () => Response.json({ messages: [{ id: "wamid.accepted" }] }),
      expected: { ok: true, kind: "accepted", providerId: "wamid.accepted" },
    },
    {
      response: () => new Response("not JSON"),
      expected: {
        ok: false,
        kind: "malformed_response",
        status: 200,
        message: "graph_invalid_json",
      },
    },
    {
      response: () => Response.json(null),
      expected: {
        ok: false,
        kind: "malformed_response",
        status: 200,
        message: "graph_missing_message_id",
      },
    },
    {
      response: () => {
        throw new Error("Connection lost");
      },
      expected: {
        ok: false,
        kind: "network_error",
        message: "Connection lost",
      },
    },
  ])(
    "classifies acceptance, malformed bodies and network failures ($expected.kind)",
    async ({ response, expected }) => {
      expect(
        await sendWhatsAppText(
          { phoneNumberId: "phone", to: "recipient", text: "Hello" },
          { token: "test-token", fetch: async () => response() },
        ),
      ).toEqual(expected);
    },
  );
  it("accepts read/typing responses without message ids", async () => {
    expect(
      await sendWhatsAppTypingIndicator(
        { phoneNumberId: "phone", messageId: "wamid.inbound" },
        {
          token: "test-token",
          fetch: async () => Response.json({ success: true }),
        },
      ),
    ).toEqual({ ok: true, kind: "receipt_accepted", providerId: null });
  });
  it("identifies Meta's re-engagement error as the closed window code", () => {
    expect(WHATSAPP_WINDOW_CLOSED_CODE).toBe(131047);
  });
  it.each([false, true])(
    "distinguishes missing credentials from explicit local noop (%s)",
    async (localNoop) => {
      const outcome = await sendWhatsAppText(
        { phoneNumberId: "phone", to: "recipient", text: "Hello" },
        {
          token: null,
          localNoop,
          fetch: async () => {
            throw new Error("must not send");
          },
        },
      );
      expect(outcome).toEqual(
        localNoop
          ? { ok: true, kind: "local_noop", providerId: null }
          : {
              ok: false,
              kind: "missing_credentials",
              message: "WHATSAPP_SYSTEM_USER_TOKEN is not set",
            },
      );
    },
  );
  it("preserves the WhatsApp error code, subcode and details independently", async () => {
    const outcome = await sendWhatsAppText(
      { phoneNumberId: "phone", to: "recipient", text: "Hello" },
      {
        token: "test-token",
        fetch: async () =>
          Response.json(
            {
              error: {
                code: 131047,
                error_subcode: 42,
                message: "Re-engagement",
                error_data: { details: "Window closed" },
              },
            },
            { status: 400 },
          ),
      },
    );
    expect(outcome).toEqual({
      ok: false,
      kind: "whatsapp_error",
      code: 131047,
      subcode: 42,
      details: "Window closed",
      status: 400,
      message: "Re-engagement",
    });
  });
  it.each(["text", "template", "interactive"])(
    "rejects a %s success without a message id",
    async (type) => {
      const dependencies = {
        token: "test-token",
        localNoop: false,
        fetch: async () => Response.json({ success: true }),
      };
      const recipient = { phoneNumberId: "phone", to: "recipient" };
      const outcome =
        type === "text"
          ? await sendWhatsAppText(
              { ...recipient, text: "Hello" },
              dependencies,
            )
          : type === "template"
            ? await sendWhatsAppTemplate(
                {
                  ...recipient,
                  templateName: "booking_confirmation",
                  languageCode: "en",
                  params: [],
                },
                dependencies,
              )
            : await sendWhatsAppInteractive(
                {
                  ...recipient,
                  body: "Confirm?",
                  buttons: [{ id: "confirm", title: "Confirm" }],
                },
                dependencies,
              );
      expect(outcome).toEqual({
        ok: false,
        kind: "malformed_response",
        status: 200,
        message: "graph_missing_message_id",
      });
    },
  );
  it("reports a non-JSON HTTP error as failure, not acceptance", async () => {
    const outcome = await sendWhatsAppText(
      { phoneNumberId: "phone", to: "recipient", text: "Hello" },
      {
        token: "test-token",
        localNoop: false,
        fetch: async () => new Response("Unavailable", { status: 503 }),
      },
    );
    expect(outcome).toEqual({
      ok: false,
      kind: "http_error",
      status: 503,
      message: "graph_http_503",
    });
  });
});
