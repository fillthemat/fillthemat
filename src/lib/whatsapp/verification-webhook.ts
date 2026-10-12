import {
  authenticateCarrierWebhook,
  type CarrierWebhookConfig,
  carrierWebhookConfig,
  carrierXml,
} from "./carrier-webhook";
import { createWhatsAppConnection, type NumberProvider } from "./connection";
import { numberProviderFromEnv } from "./number-provider";

export { verifyTwilioRequest } from "./carrier-webhook";

export async function handleTwilioVerification(
  request: Request,
  dependencies: {
    config?: CarrierWebhookConfig;
    connection?: ReturnType<typeof createWhatsAppConnection>;
    numberProvider?: NumberProvider;
  } = {},
): Promise<Response> {
  const config = dependencies.config ?? carrierWebhookConfig();
  if (!config.smsWebhookUrl)
    return new Response("unconfigured", { status: 503 });
  const authenticated = await authenticateCarrierWebhook(
    request,
    config,
    new URL(config.smsWebhookUrl),
  );
  if (!authenticated.ok) return authenticated.response;
  const { params, allocationId } = authenticated;
  const body = params.get("Body") ?? "";
  const codes = [...body.matchAll(/\b(\d{3})[- ]?(\d{3})\b/g)];
  const code =
    codes.length === 1 && /whatsapp/i.test(body) ? codes[0] : undefined;
  const messageId = params.get("MessageSid") ?? "";
  if (code && /^SM[0-9a-fA-F]{32}$/.test(messageId)) {
    // Twilio signatures are replayable. Read the carrier's original creation
    // time instead of trusting an unsigned/absent timestamp in the callback.
    const provider = dependencies.numberProvider ?? numberProviderFromEnv();
    const receivedAt =
      await provider.verificationMessageReceivedAt?.(messageId);
    if (!receivedAt) return carrierXml();
    await (
      dependencies.connection ?? createWhatsAppConnection()
    ).receiveVerificationCode({
      allocationId,
      number: params.get("To") ?? "",
      messageId,
      code: `${code[1]}${code[2]}`,
      receivedAt,
    });
  }
  return carrierXml();
}
