import { validateRequest } from "twilio/lib/webhooks/webhooks";
import { z } from "zod";
import { WHATSAPP_MAX_BODY_BYTES } from "./config";
import { createWhatsAppConnection, type NumberProvider } from "./connection";
import { numberProviderFromEnv } from "./number-provider";

/** Use the provider's validator, not Meta's HMAC or a hand-rolled signature. */
export function verifyTwilioRequest({
  url,
  params,
  authToken,
  signature,
}: {
  url: string;
  params: URLSearchParams;
  authToken: string;
  signature: string;
}): boolean {
  // Do not collapse duplicate values into a different signed request.
  if ([...params.keys()].some((key) => params.getAll(key).length !== 1))
    return false;
  return validateRequest(authToken, signature, url, Object.fromEntries(params));
}

type CarrierWebhookConfig = {
  accountSid: string;
  authToken: string;
  smsWebhookUrl: string;
};

export async function handleTwilioVerification(
  request: Request,
  dependencies: {
    config?: CarrierWebhookConfig;
    connection?: ReturnType<typeof createWhatsAppConnection>;
    numberProvider?: NumberProvider;
  } = {},
): Promise<Response> {
  const config = dependencies.config ?? {
    accountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
    authToken: process.env.TWILIO_AUTH_TOKEN ?? "",
    smsWebhookUrl: process.env.TWILIO_SMS_WEBHOOK_URL ?? "",
  };
  if (!config.accountSid || !config.authToken || !config.smsWebhookUrl)
    return new Response("unconfigured", { status: 503 });
  if (
    !request.headers
      .get("content-type")
      ?.startsWith("application/x-www-form-urlencoded")
  )
    return new Response("invalid_content_type", { status: 415 });
  if (Number(request.headers.get("content-length")) > WHATSAPP_MAX_BODY_BYTES)
    return new Response("body_too_large", { status: 413 });
  const raw = await request.text();
  if (Buffer.byteLength(raw) > WHATSAPP_MAX_BODY_BYTES)
    return new Response("body_too_large", { status: 413 });
  const incoming = new URL(request.url);
  const allocationId = z
    .uuid()
    .safeParse(incoming.searchParams.get("allocationId"));
  if (!allocationId.success)
    return new Response("invalid_allocation", { status: 400 });
  // Use the configured public URL, not untrusted Host/forwarding headers. This
  // also works behind a reverse proxy that presents an internal origin to Next.
  const signedUrl = new URL(config.smsWebhookUrl);
  signedUrl.searchParams.set("allocationId", allocationId.data);
  if (
    incoming.pathname !== signedUrl.pathname ||
    incoming.search !== signedUrl.search
  )
    return new Response("invalid_callback_url", { status: 400 });
  const params = new URLSearchParams(raw);
  if (
    !verifyTwilioRequest({
      url: signedUrl.href,
      params,
      authToken: config.authToken,
      signature: request.headers.get("x-twilio-signature") ?? "",
    }) ||
    params.get("AccountSid") !== config.accountSid
  )
    return new Response("invalid_signature", { status: 403 });
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
    if (!receivedAt)
      return new Response("<Response></Response>", {
        headers: { "Content-Type": "text/xml" },
      });
    await (
      dependencies.connection ?? createWhatsAppConnection()
    ).receiveVerificationCode({
      allocationId: allocationId.data,
      number: params.get("To") ?? "",
      messageId,
      code: `${code[1]}${code[2]}`,
      receivedAt,
    });
  }
  return new Response("<Response></Response>", {
    headers: { "Content-Type": "text/xml" },
  });
}
