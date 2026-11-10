import "server-only";
import { generateId } from "ai";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/** Platform-only atomic confirmation; no provider I/O until this returns. */
export async function confirmWhatsAppBooking(input: {
  schoolId: string;
  conversationId: string;
  generation: string;
  intentId: string | null;
  waId: string;
  phoneNumberId: string;
  wamid: string;
  inboundMessageId: string;
  inboundText: string;
  profileName: string | null;
  now: Date;
}) {
  const { data } = await createAdminClient()
    .rpc("confirm_whatsapp_booking", {
      p_school_id: input.schoolId,
      p_conversation_id: input.conversationId,
      p_generation: input.generation,
      p_intent_id: input.intentId ?? undefined,
      p_wa_id: input.waId,
      p_phone_number_id: input.phoneNumberId,
      p_wamid: input.wamid,
      p_inbound_id: input.inboundMessageId,
      p_inbound_text: input.inboundText,
      p_reply_id: randomUUID(),
      p_reply_message_id: generateId(),
      p_profile_name: input.profileName ?? undefined,
      p_now: input.now.toISOString(),
    })
    .throwOnError();
  const result = data?.[0];
  if (!result) throw new Error("confirmation_result_missing");
  return result;
}
