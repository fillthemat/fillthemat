import {
  authenticateCarrierWebhook,
  type CarrierWebhookConfig,
  carrierWebhookConfig,
  carrierXml,
  voiceWebhookUrl,
} from "./carrier-webhook";
import { createWhatsAppConnection, type NumberProvider } from "./connection";
import { numberProviderFromEnv } from "./number-provider";

const digitWords: Record<string, string> = {
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
};
function transcribedCode(text: string) {
  const normalized = text
    .toLowerCase()
    .replace(
      /\b(zero|one|two|three|four|five|six|seven|eight|nine)\b/g,
      (word) => digitWords[word],
    );
  // Repeated copies of one code are common in automated calls. Never guess
  // between different codes, trim extra digits, or join unrelated numbers.
  const matches = [...normalized.matchAll(/(?<!\d)(\d(?:[\s,-]*\d)*)(?!\d)/g)];
  const codes = matches.map((match) => match[1].replace(/\D/g, ""));
  return codes.length &&
    codes.every((code) => code.length === 6) &&
    new Set(codes).size === 1
    ? codes[0]
    : null;
}

/** Records only active signup calls. Signed asynchronous transcription feeds
 * the same short-lived code panel as SMS; no raw recording URL is exposed.
 */
export async function handleTwilioVoiceVerification(
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
  const incoming = new URL(request.url);
  const callbackUrl = voiceWebhookUrl(config.smsWebhookUrl);
  // Maintain the provider's exact parameter order for signature verification.
  const allocationId = incoming.searchParams.get("allocationId");
  if (allocationId) callbackUrl.searchParams.set("allocationId", allocationId);
  const transcription = incoming.searchParams.get("stage") === "transcription";
  const finished = incoming.searchParams.get("stage") === "finished";
  if (transcription) callbackUrl.searchParams.set("stage", "transcription");
  if (finished) callbackUrl.searchParams.set("stage", "finished");
  const authenticated = await authenticateCarrierWebhook(
    request,
    config,
    callbackUrl,
  );
  if (!authenticated.ok) return authenticated.response;
  const { params } = authenticated;
  if (finished) return carrierXml("<Hangup/>");
  const connection = dependencies.connection ?? createWhatsAppConnection();
  if (!transcription) {
    if (
      !(await connection.acceptsVerificationFor(
        authenticated.allocationId,
        params.get("To") ?? "",
      ))
    )
      return carrierXml("<Hangup/>");
    callbackUrl.searchParams.set("stage", "transcription");
    const callback = callbackUrl.href
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;");
    callbackUrl.searchParams.set("stage", "finished");
    const action = callbackUrl.href
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;");
    return carrierXml(
      `<Record action="${action}" method="POST" transcribe="true" transcribeCallback="${callback}" playBeep="false" maxLength="60" timeout="5"/>`,
    );
  }
  const messageId = params.get("RecordingSid") ?? "";
  if (!/^RE[0-9a-fA-F]{32}$/.test(messageId)) return carrierXml();
  const provider = dependencies.numberProvider ?? numberProviderFromEnv();
  try {
    const code =
      params.get("TranscriptionStatus") === "completed"
        ? transcribedCode(params.get("TranscriptionText") ?? "")
        : null;
    if (code) {
      const call = await provider.verificationCall?.(
        params.get("CallSid") ?? "",
      );
      if (call)
        await connection.receiveVerificationCode({
          allocationId: authenticated.allocationId,
          number: call.number,
          messageId,
          code,
          receivedAt: call.receivedAt,
        });
    }
  } finally {
    // No enduring OTP audio/transcript at the vendor after processing, including
    // unparseable/failed transcriptions. DELETE is safe to replay.
    await provider.discardVerificationRecording?.({
      recordingId: messageId,
      transcriptionId: params.get("TranscriptionSid"),
    });
  }
  return carrierXml();
}
