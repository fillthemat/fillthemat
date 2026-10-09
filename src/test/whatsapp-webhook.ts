import { createHmac } from "node:crypto";
import { WHATSAPP_STUB_APP_SECRET } from "@/lib/whatsapp/config";
import buttonReply from "./fixtures/whatsapp/button-reply.json";
import textInbound from "./fixtures/whatsapp/text-inbound.json";

/** The `x-hub-signature-256` value Meta sends for `body`. */
export function sign(body: string, secret = WHATSAPP_STUB_APP_SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/** The text-inbound fixture, sent from `waId` to the school's number. */
export function textInboundPayload({
  phoneNumberId,
  waId,
  wamid,
  text,
}: {
  phoneNumberId: string;
  waId: string;
  wamid: string;
  text?: string;
}) {
  const payload = structuredClone(textInbound);
  const { value } = payload.entry[0].changes[0];
  value.metadata.phone_number_id = phoneNumberId;
  value.contacts[0].wa_id = waId;
  value.messages[0].from = waId;
  value.messages[0].id = wamid;
  if (text !== undefined) value.messages[0].text.body = text;
  return payload;
}

/** The button-reply fixture: `waId` pressed the reply button `buttonId`. */
export function buttonReplyPayload({
  phoneNumberId,
  waId,
  wamid,
  buttonId,
}: {
  phoneNumberId: string;
  waId: string;
  wamid: string;
  buttonId: string;
}) {
  const payload = structuredClone(buttonReply);
  const { value } = payload.entry[0].changes[0];
  value.metadata.phone_number_id = phoneNumberId;
  value.contacts[0].wa_id = waId;
  value.messages[0].from = waId;
  value.messages[0].id = wamid;
  value.messages[0].interactive.button_reply.id = buttonId;
  return payload;
}

/** A webhook POST of `payload`, signed like Meta signs it. */
export function post(
  payload: unknown,
  secret = WHATSAPP_STUB_APP_SECRET,
): Request {
  const body = JSON.stringify(payload);
  return new Request("http://127.0.0.1:3000/api/webhooks/whatsapp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": sign(body, secret),
    },
    body,
  });
}
