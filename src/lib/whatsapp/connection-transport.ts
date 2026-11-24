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
  schoolId: string | undefined,
  work: (token: string | null) => Promise<T>,
): Promise<T | { ok: false; kind: "missing_credentials"; message: string }> {
  const connection = await liveWhatsAppConnection(phoneNumberId);
  if (!connection)
    return { ok: false, kind: "missing_credentials", message: "whatsapp_connection_not_live" };
  if (schoolId !== undefined && connection.school_id !== schoolId)
    return {
      ok: false,
      kind: "missing_credentials",
      message: "whatsapp_connection_school_mismatch",
    };
  const outcome = await work(await resolveWhatsAppToken(connection.school_id));
  if (!outcome.ok && outcome.kind === "whatsapp_error" && outcome.code === 131042) {
    await markWhatsAppBrokenCard(phoneNumberId);
  }
  return outcome;
}

export const connectionTransport = {
  sendText: (input: Parameters<typeof sendWhatsAppText>[0] & { schoolId: string }) =>
    send(input.phoneNumberId, input.schoolId, (token) => sendWhatsAppText(input, { token })),
  sendTemplate: (input: Parameters<typeof sendWhatsAppTemplate>[0] & { schoolId: string }) =>
    send(input.phoneNumberId, input.schoolId, (token) => sendWhatsAppTemplate(input, { token })),
  sendInteractive: (input: Parameters<typeof sendWhatsAppInteractive>[0] & { schoolId: string }) =>
    send(input.phoneNumberId, input.schoolId, (token) => sendWhatsAppInteractive(input, { token })),
};

export function sendConnectionTypingIndicator(
  input: Parameters<typeof sendWhatsAppTypingIndicator>[0],
) {
  return send(input.phoneNumberId, undefined, (token) =>
    sendWhatsAppTypingIndicator(input, { token }),
  );
}
