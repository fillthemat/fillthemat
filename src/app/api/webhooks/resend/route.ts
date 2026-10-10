import { recordResendDeliveryEvent } from "@/lib/email/delivery-event";
import { getResend } from "@/lib/email/resend";

const MAX_BODY_BYTES = 64_000;

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "unconfigured" }, { status: 500 });

  const payload = await request.text();
  if (Buffer.byteLength(payload, "utf8") > MAX_BODY_BYTES) {
    return Response.json({ error: "too_large" }, { status: 413 });
  }

  let event: ReturnType<ReturnType<typeof getResend>["webhooks"]["verify"]>;
  try {
    event = getResend().webhooks.verify({
      payload,
      headers: {
        id: request.headers.get("svix-id") ?? "",
        timestamp: request.headers.get("svix-timestamp") ?? "",
        signature: request.headers.get("svix-signature") ?? "",
      },
      webhookSecret: secret,
    });
  } catch {
    return Response.json({ error: "invalid_signature" }, { status: 401 });
  }

  await recordResendDeliveryEvent(event);
  return Response.json({ ok: true });
}
