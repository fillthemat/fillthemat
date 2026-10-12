import { validateRequest } from "twilio/lib/webhooks/webhooks";
import { z } from "zod";
import { WHATSAPP_MAX_BODY_BYTES } from "./config";

export type CarrierWebhookConfig = {
  accountSid: string;
  authToken: string;
  smsWebhookUrl: string;
};
export function carrierWebhookConfig(): CarrierWebhookConfig {
  return {
    accountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
    authToken: process.env.TWILIO_AUTH_TOKEN ?? "",
    smsWebhookUrl: process.env.TWILIO_SMS_WEBHOOK_URL ?? "",
  };
}
export function voiceWebhookUrl(smsWebhookUrl: string) {
  const url = new URL(smsWebhookUrl);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/voice`;
  return url;
}

/** Provider validator; duplicate form values must not change the signed body. */
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
  if ([...params.keys()].some((key) => params.getAll(key).length !== 1))
    return false;
  return validateRequest(authToken, signature, url, Object.fromEntries(params));
}

export async function authenticateCarrierWebhook(
  request: Request,
  config: CarrierWebhookConfig,
  callbackUrl: URL,
): Promise<
  | { ok: true; params: URLSearchParams; allocationId: string; signedUrl: URL }
  | { ok: false; response: Response }
> {
  const reject = (message: string, status: number) => ({
    ok: false as const,
    response: new Response(message, { status }),
  });
  if (!config.accountSid || !config.authToken || !config.smsWebhookUrl)
    return reject("unconfigured", 503);
  if (
    !request.headers
      .get("content-type")
      ?.startsWith("application/x-www-form-urlencoded")
  )
    return reject("invalid_content_type", 415);
  if (Number(request.headers.get("content-length")) > WHATSAPP_MAX_BODY_BYTES)
    return reject("body_too_large", 413);
  const raw = await request.text();
  if (Buffer.byteLength(raw) > WHATSAPP_MAX_BODY_BYTES)
    return reject("body_too_large", 413);
  const incoming = new URL(request.url);
  const allocationId = z
    .uuid()
    .safeParse(incoming.searchParams.get("allocationId"));
  if (!allocationId.success) return reject("invalid_allocation", 400);
  callbackUrl.searchParams.set("allocationId", allocationId.data);
  // The configured public origin, never Host/forwarding headers, is signed.
  if (
    incoming.pathname !== callbackUrl.pathname ||
    incoming.search !== callbackUrl.search
  )
    return reject("invalid_callback_url", 400);
  const params = new URLSearchParams(raw);
  if (
    !verifyTwilioRequest({
      url: callbackUrl.href,
      params,
      authToken: config.authToken,
      signature: request.headers.get("x-twilio-signature") ?? "",
    }) ||
    params.get("AccountSid") !== config.accountSid
  )
    return reject("invalid_signature", 403);
  return {
    ok: true,
    params,
    allocationId: allocationId.data,
    signedUrl: callbackUrl,
  };
}

export function carrierXml(body = "") {
  return new Response(`<Response>${body}</Response>`, {
    headers: { "Content-Type": "text/xml" },
  });
}
