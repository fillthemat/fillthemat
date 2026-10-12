import { createHash } from "node:crypto";
import { z } from "zod";
import {
  authenticateCarrierWebhook,
  type CarrierWebhookConfig,
  carrierWebhookConfig,
} from "./carrier-webhook";
import { createWhatsAppConnection, type NumberProvider } from "./connection";
import { numberProviderFromEnv } from "./number-provider";
import { transcribedCode } from "./voice-verification-webhook";

const envelopeSchema = z.object({
  event: z.string(),
  channel: z.string(),
  agentId: z.string(),
  data: z.object({
    numberId: z.string(),
    to: z.string(),
    direction: z.string(),
    message: z.string().optional(),
    receivedAt: z.iso.datetime({ offset: true }).optional(),
    callId: z.string().optional(),
    transcript: z
      .union([
        z.string(),
        z.array(z.object({ role: z.string(), content: z.string() })),
      ])
      .optional(),
  }),
});

/** Signed carrier events feed the short-lived code panel, never Meta messaging. */
export async function handleAgentPhoneVerification(
  request: Request,
  dependencies: {
    config?: CarrierWebhookConfig;
    connection?: ReturnType<typeof createWhatsAppConnection>;
    numberProvider?: NumberProvider;
    now?: () => Date;
  } = {},
): Promise<Response> {
  const config = dependencies.config ?? carrierWebhookConfig();
  const authenticated = await authenticateCarrierWebhook(
    request,
    config,
    dependencies.now?.(),
  );
  if (!authenticated.ok) return authenticated.response;
  const parsed = envelopeSchema.safeParse(authenticated.payload);
  if (!parsed.success) return new Response("invalid_payload", { status: 400 });
  const { event, channel, agentId, data } = parsed.data;
  const voice = channel === "voice";
  const acknowledge = (hangup = false) =>
    Response.json(voice ? { text: "", hangup } : {});
  if (agentId !== config.agentId)
    return new Response("invalid_agent", { status: 403 });
  if (
    data.direction !== "inbound" ||
    !(
      (event === "agent.message" && (channel === "sms" || voice)) ||
      (event === "agent.call_ended" && voice)
    )
  )
    return acknowledge();
  const provider = dependencies.numberProvider ?? numberProviderFromEnv();
  // Look up the authenticated number tag instead of assuming where a vendor
  // puts externalId in its webhook envelope. Also binds numberId to recipient.
  const rental = await provider.verificationNumber?.(data.numberId);
  if (!rental || rental.number !== data.to) return acknowledge(true);
  const connection = dependencies.connection ?? createWhatsAppConnection();
  if (
    !(await connection.acceptsVerificationFor(
      rental.allocationId,
      rental.number,
    ))
  )
    return acknowledge(true);
  let code: string | null = null;
  let receivedAt: Date | undefined;
  if (voice) {
    const text =
      typeof data.transcript === "string"
        ? data.transcript
        : (data.transcript
            ?.filter((turn) => turn.role === "user")
            .map((turn) => turn.content)
            .join(" ") ?? "");
    code = transcribedCode(text);
    if (code && data.callId) {
      const call = await provider.verificationCall?.(data.callId);
      if (call?.resourceId === data.numberId && call.number === rental.number)
        receivedAt = call.receivedAt;
    }
  } else {
    const text = data.message ?? "";
    const codes = [...text.matchAll(/\b(\d{3})[- ]?(\d{3})\b/g)];
    if (codes.length === 1 && /whatsapp/i.test(text))
      code = `${codes[0][1]}${codes[0][2]}`;
    if (data.receivedAt) receivedAt = new Date(data.receivedAt);
  }
  // Delivery headers are not covered by the HMAC. Deduplicate the signed
  // original SMS identity (or call identity across partial/final transcripts),
  // so changing X-Webhook-ID cannot bypass replay protection.
  const messageId = createHash("sha256")
    .update(
      JSON.stringify(
        voice
          ? ["voice", data.numberId, data.callId]
          : ["sms", data.numberId, data.receivedAt, data.message],
      ),
    )
    .digest("hex");
  if (code && receivedAt)
    await connection.receiveVerificationCode({
      allocationId: rental.allocationId,
      number: rental.number,
      messageId,
      code,
      receivedAt,
    });
  // Stay silent for partial/ambiguous speech; hang up after a complete code.
  return acknowledge(Boolean(code && receivedAt));
}
