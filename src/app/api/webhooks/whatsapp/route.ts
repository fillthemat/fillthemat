import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { sendWhatsAppTypingIndicator } from "@/lib/whatsapp/client";
import {
  WHATSAPP_MAX_BODY_BYTES,
  whatsappAppSecret,
  whatsappVerifyToken,
} from "@/lib/whatsapp/config";
import { applyWhatsAppStatuses } from "@/lib/whatsapp/deliveries";
import { enqueueInboundJobs } from "@/lib/whatsapp/jobs";
import { parseInboundWhatsAppMessages } from "@/lib/whatsapp/parse";
import { verifyWhatsAppSignature } from "@/lib/whatsapp/signature";
import { parseInboundWhatsAppStatuses } from "@/lib/whatsapp/status";
import { runWhatsAppWorkerOnce } from "@/lib/whatsapp/worker";

export const maxDuration = 300;

/**
 * The body is read with `request.text()` BEFORE any signature check so the
 * HMAC is computed over the exact raw bytes Meta signed — never
 * `request.json()` first. Size cap matches the Resend webhook.
 */
export async function GET(request: Request) {
  const verifyToken = whatsappVerifyToken();
  if (!verifyToken) {
    return Response.json({ error: "unconfigured" }, { status: 500 });
  }

  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token === verifyToken && challenge !== null) {
    return new Response(challenge, {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }
  return Response.json({ error: "verification_failed" }, { status: 403 });
}

export async function POST(request: Request) {
  const secret = whatsappAppSecret();
  if (!secret) return Response.json({ error: "unconfigured" }, { status: 500 });

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > WHATSAPP_MAX_BODY_BYTES) {
    return Response.json({ error: "too_large" }, { status: 413 });
  }

  const signatureHeader = request.headers.get("x-hub-signature-256") ?? "";
  if (!verifyWhatsAppSignature(rawBody, signatureHeader, secret)) {
    return Response.json({ error: "invalid_signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "invalid" }, { status: 400 });
  }

  // Enqueue-then-ack (decision D12): the webhook never runs the agent. Inbound
  // messages become `whatsapp_jobs` rows (idempotent by wamid) for the worker;
  // status callbacks are applied directly by `provider_id` (wamid). Always ack
  // 200 fast so Meta does not retry the whole webhook on a small/unknown event.
  const statuses = parseInboundWhatsAppStatuses(payload);
  const messages = parseInboundWhatsAppMessages(payload);

  // Perceived-immediacy lever: mark read + typing indicator in one cheap Graph
  // call, best-effort so Meta's 200 is never hard-gated on it.
  await Promise.allSettled(
    messages.map((message) =>
      sendWhatsAppTypingIndicator({
        phoneNumberId: message.phoneNumberId,
        messageId: message.wamid,
      }),
    ),
  );

  try {
    if (statuses.length > 0) await applyWhatsAppStatuses(statuses);
    if (messages.length > 0) await enqueueInboundJobs(messages);
  } catch (error) {
    console.error("whatsapp: webhook enqueue/status failed", error);
  }

  // Wake the worker after the 200 flushes so inbound messages are answered
  // immediately instead of waiting for the daily cron tick (spike follow-up).
  // Status-only callbacks don't need a sweep.
  //
  // RISK (verify post-deploy): `after()` is implemented via Vercel's `waitUntil`;
  // support on Vercel's Bun runtime (bunVersion in vercel.ts) is not explicitly
  // documented. If Bun doesn't honor it, this fast path silently degrades to the
  // daily cron — the job is already committed/enqueued above, so nothing is lost,
  // only the instant dispatch. Verify by sending one inbound and confirming the
  // reply lands in seconds (not at 05:00). Fallback if it doesn't: Supabase
  // pg_cron (docs/decisions/whatsapp-cron-after.md) or a Vercel Pro cron.
  if (messages.length > 0) {
    const kickWorker = () =>
      runWhatsAppWorkerOnce(randomUUID()).catch((error) => {
        console.error("whatsapp: after-worker failed", error);
      });

    try {
      after(kickWorker);
    } catch {
      // `after` requires a Next request scope; when the handler is invoked
      // directly (tests / local replay) it throws and the enqueued job is
      // drained by the daily cron or `bun run whatsapp:worker` instead.
    }
  }

  return Response.json({ ok: true });
}
