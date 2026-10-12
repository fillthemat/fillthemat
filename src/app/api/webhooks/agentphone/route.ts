import { handleAgentPhoneVerification } from "@/lib/whatsapp/verification-webhook";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    return await handleAgentPhoneVerification(request);
  } catch {
    console.error(
      JSON.stringify({ event: "whatsapp_verification_webhook_failed" }),
    );
    return new Response("verification_failed", { status: 500 });
  }
}
