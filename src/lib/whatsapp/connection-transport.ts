import "server-only";
import {
  sendWhatsAppInteractive,
  sendWhatsAppTemplate,
  sendWhatsAppText,
  sendWhatsAppTypingIndicator,
  type WhatsAppReceiptOutcome,
  type WhatsAppSendOutcome,
} from "./client";
import {
  liveWhatsAppConnection,
  markWhatsAppBrokenCard,
  resolveWhatsAppToken,
} from "./connections";

async function send<T extends WhatsAppSendOutcome | WhatsAppReceiptOutcome>(
  phoneNumberId: string,
  work: (token: string | null) => Promise<T>,
): Promise<T | { ok: false; kind: "missing_credentials"; message: string }> {
  const connection = await liveWhatsAppConnection(phoneNumberId);
  if (!connection)
    return { ok: false, kind: "missing_credentials", message: "whatsapp_connection_not_live" };
  const outcome = await work(await resolveWhatsAppToken(connection.school_id));
  if (!outcome.ok && outcome.kind === "whatsapp_error" && outcome.code === 131042) {
    await markWhatsAppBrokenCard(phoneNumberId);
  }
  return outcome;
}

export const connectionTransport = {
  sendText: (input: Parameters<typeof sendWhatsAppText>[0]) =>
    send(input.phoneNumberId, (token) => sendWhatsAppText(input, { token })),
  sendTemplate: (input: Parameters<typeof sendWhatsAppTemplate>[0]) =>
    send(input.phoneNumberId, (token) => sendWhatsAppTemplate(input, { token })),
  sendInteractive: (input: Parameters<typeof sendWhatsAppInteractive>[0]) =>
    send(input.phoneNumberId, (token) => sendWhatsAppInteractive(input, { token })),
};

export function sendConnectionTypingIndicator(
  input: Parameters<typeof sendWhatsAppTypingIndicator>[0],
) {
  return send(input.phoneNumberId, (token) => sendWhatsAppTypingIndicator(input, { token }));
}
