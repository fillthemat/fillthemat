import { handleTwilioVoiceVerification } from "@/lib/whatsapp/voice-verification-webhook";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    return await handleTwilioVoiceVerification(request);
  } catch {
    console.error(
      JSON.stringify({ event: "whatsapp_voice_verification_webhook_failed" }),
    );
    return new Response("verification_failed", { status: 500 });
  }
}
