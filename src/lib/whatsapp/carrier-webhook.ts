import { createHmac, timingSafeEqual } from "node:crypto";
import { WHATSAPP_MAX_BODY_BYTES } from "./config";

export type CarrierWebhookConfig = { secret: string; agentId: string };
export function carrierWebhookConfig(): CarrierWebhookConfig {
  return {
    secret: process.env.AGENTPHONE_WEBHOOK_SECRET ?? "",
    agentId: process.env.AGENTPHONE_VERIFICATION_AGENT_ID ?? "",
  };
}

export function verifyAgentPhoneRequest({
  rawBody,
  timestamp,
  secret,
  signature,
  now = new Date(),
}: {
  rawBody: string;
  timestamp: string;
  secret: string;
  signature: string;
  now?: Date;
}): boolean {
  if (
    !secret ||
    !/^\d{10}$/.test(timestamp) ||
    !/^sha256=[a-fA-F0-9]{64}$/.test(signature)
  )
    return false;
  if (Math.abs(now.getTime() / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"));
}

export async function authenticateCarrierWebhook(
  request: Request,
  config: CarrierWebhookConfig,
  now?: Date,
): Promise<
  | { ok: true; payload: unknown; deliveryId: string }
  | { ok: false; response: Response }
> {
  const reject = (message: string, status: number) => ({
    ok: false as const,
    response: new Response(message, { status }),
  });
  if (!config.secret || !config.agentId) return reject("unconfigured", 503);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return reject("invalid_content_type", 415);
  if (Number(request.headers.get("content-length")) > WHATSAPP_MAX_BODY_BYTES)
    return reject("body_too_large", 413);
  const raw = await request.text();
  if (Buffer.byteLength(raw) > WHATSAPP_MAX_BODY_BYTES)
    return reject("body_too_large", 413);
  if (
    !verifyAgentPhoneRequest({
      rawBody: raw,
      timestamp: request.headers.get("x-webhook-timestamp") ?? "",
      signature: request.headers.get("x-webhook-signature") ?? "",
      secret: config.secret,
      now,
    })
  )
    return reject("invalid_signature", 403);
  const deliveryId = request.headers.get("x-webhook-id") ?? "";
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(deliveryId))
    return reject("invalid_delivery", 400);
  try {
    return { ok: true, payload: JSON.parse(raw), deliveryId };
  } catch {
    return reject("invalid_payload", 400);
  }
}
