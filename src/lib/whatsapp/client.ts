import { isLocalWhatsAppNoop } from "@/lib/dev-flags";
import {
  whatsappApiVersion,
  whatsappGraphBase,
  whatsappSystemUserToken,
} from "./config";
import { whatsappTemplateComponents } from "./templates";

export type WhatsAppSendFailure =
  | { ok: false; kind: "missing_credentials"; message: string }
  | { ok: false; kind: "network_error"; message: string }
  | {
      ok: false;
      kind: "whatsapp_error";
      code: number | null;
      subcode: number | null;
      details: string | null;
      status: number;
      message: string;
    }
  | { ok: false; kind: "malformed_response"; status: number; message: string }
  | { ok: false; kind: "http_error"; status: number; message: string };

export type WhatsAppSendOutcome =
  | { ok: true; kind: "accepted"; providerId: string }
  | { ok: true; kind: "local_noop"; providerId: null }
  | WhatsAppSendFailure;

export type WhatsAppReceiptOutcome =
  | { ok: true; kind: "receipt_accepted" | "local_noop"; providerId: null }
  | WhatsAppSendFailure;

export type WhatsAppGraphDependencies = {
  fetch?: typeof fetch;
  token?: string | null;
  localNoop?: boolean;
};

export const WHATSAPP_WINDOW_CLOSED_CODE = 131047;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function graphPost(
  phoneNumberId: string,
  payload: Record<string, unknown>,
  dependencies?: WhatsAppGraphDependencies,
  requireMessageId?: true,
): Promise<WhatsAppSendOutcome>;
function graphPost(
  phoneNumberId: string,
  payload: Record<string, unknown>,
  dependencies: WhatsAppGraphDependencies | undefined,
  requireMessageId: false,
): Promise<WhatsAppReceiptOutcome>;

function graphPost(
  phoneNumberId: string,
  payload: Record<string, unknown>,
  dependencies: WhatsAppGraphDependencies = {},
  requireMessageId = true,
): Promise<WhatsAppSendOutcome | WhatsAppReceiptOutcome> {
  const token =
    dependencies.token === undefined
      ? whatsappSystemUserToken()
      : dependencies.token;
  if (!token) {
    if (dependencies.localNoop ?? isLocalWhatsAppNoop()) {
      console.info(
        `[local whatsapp noop] POST ${phoneNumberId}/messages: ${JSON.stringify(payload)}`,
      );
      return Promise.resolve({
        ok: true,
        kind: "local_noop",
        providerId: null,
      });
    }
    return Promise.resolve({
      ok: false,
      kind: "missing_credentials",
      message: "WHATSAPP_SYSTEM_USER_TOKEN is not set",
    });
  }

  const url = `${whatsappGraphBase()}/${whatsappApiVersion()}/${phoneNumberId}/messages`;
  return (dependencies.fetch ?? fetch)(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  })
    .then(async (response) => {
      let body: unknown;
      let invalidJson = false;
      try {
        body = await response.json();
      } catch {
        invalidJson = true;
      }
      const json = record(body);
      if (json.error && typeof json.error === "object") {
        const error = record(json.error);
        const details = record(error.error_data).details;
        return {
          ok: false as const,
          kind: "whatsapp_error" as const,
          code: typeof error.code === "number" ? error.code : null,
          subcode:
            typeof error.error_subcode === "number"
              ? error.error_subcode
              : null,
          details: typeof details === "string" ? details : null,
          status: response.status,
          message:
            typeof error.message === "string" ? error.message : "graph_error",
        };
      }
      if (!response.ok) {
        return {
          ok: false as const,
          kind: "http_error" as const,
          status: response.status,
          message: `graph_http_${response.status}`,
        };
      }
      if (invalidJson) {
        return {
          ok: false as const,
          kind: "malformed_response" as const,
          status: response.status,
          message: "graph_invalid_json",
        };
      }
      if (!requireMessageId) {
        return {
          ok: true as const,
          kind: "receipt_accepted" as const,
          providerId: null,
        };
      }
      const providerId = Array.isArray(json.messages)
        ? record(json.messages[0]).id
        : null;
      if (typeof providerId !== "string" || !providerId.trim()) {
        return {
          ok: false as const,
          kind: "malformed_response" as const,
          status: response.status,
          message: "graph_missing_message_id",
        };
      }
      return { ok: true as const, kind: "accepted" as const, providerId };
    })
    .catch((error) => ({
      ok: false as const,
      kind: "network_error" as const,
      message: error instanceof Error ? error.message : "send_failed",
    }));
}

export function sendWhatsAppText(
  {
    phoneNumberId,
    to,
    text,
  }: {
    phoneNumberId: string;
    to: string;
    text: string;
  },
  dependencies?: WhatsAppGraphDependencies,
): Promise<WhatsAppSendOutcome> {
  return graphPost(
    phoneNumberId,
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body: text },
    },
    dependencies,
  );
}

/**
 * Mark an inbound message as read and show a typing indicator in one Graph
 * call. Returns `providerId: null` because a read receipt has no message id;
 * `ok: true` means Meta accepted it. This is the perceived-immediacy lever:
 * the chat shows "typing…" (≈25s TTL) while the worker crafts the real reply.
 */
export function sendWhatsAppTypingIndicator(
  {
    phoneNumberId,
    messageId,
  }: {
    phoneNumberId: string;
    messageId: string;
  },
  dependencies?: WhatsAppGraphDependencies,
): Promise<WhatsAppReceiptOutcome> {
  return graphPost(
    phoneNumberId,
    {
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
      typing_indicator: { type: "text" },
    },
    dependencies,
    false,
  );
}

export function sendWhatsAppTemplate(
  {
    phoneNumberId,
    to,
    templateName,
    languageCode,
    params,
  }: {
    phoneNumberId: string;
    to: string;
    templateName: string;
    languageCode: string;
    params: unknown[];
  },
  dependencies?: WhatsAppGraphDependencies,
): Promise<WhatsAppSendOutcome> {
  const components = whatsappTemplateComponents(params);
  return graphPost(
    phoneNumberId,
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        components,
      },
    },
    dependencies,
  );
}

// Interactive message limits (verified against Meta's Cloud API docs): body
// text ≤ 1024 chars, button title ≤ 20 chars. Truncate defensively so a long
// agent reply can never produce a malformed Graph request.
export const WHATSAPP_INTERACTIVE_BODY_CHAR_LIMIT = 1024;
export const WHATSAPP_INTERACTIVE_TITLE_CHAR_LIMIT = 20;

export function sendWhatsAppInteractive(
  {
    phoneNumberId,
    to,
    body,
    buttons,
  }: {
    phoneNumberId: string;
    to: string;
    body: string;
    buttons: Array<{ id: string; title: string }>;
  },
  dependencies?: WhatsAppGraphDependencies,
): Promise<WhatsAppSendOutcome> {
  return graphPost(
    phoneNumberId,
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: body.slice(0, WHATSAPP_INTERACTIVE_BODY_CHAR_LIMIT) },
        action: {
          buttons: buttons.map((button) => ({
            type: "reply",
            reply: {
              id: button.id.slice(0, 256),
              title: button.title.slice(
                0,
                WHATSAPP_INTERACTIVE_TITLE_CHAR_LIMIT,
              ),
            },
          })),
        },
      },
    },
    dependencies,
  );
}
