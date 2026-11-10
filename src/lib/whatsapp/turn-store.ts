import "server-only";
import { generateId } from "ai";
import { randomUUID } from "node:crypto";
import type { BookingIntent, LeadRequest } from "@/lib/ai/assistant";
import { createAdminClient } from "@/lib/supabase/admin";
import { splitWhatsAppText } from "./text";

/** Only successful prepared tool results reach this platform-owned boundary. */
export type PreparedEffect =
  | { kind: "reply" }
  | ({ kind: "booking_intent" } & BookingIntent)
  | ({ kind: "lead_request"; contactName: string } & LeadRequest)
  | { kind: "expired_confirmation" };

export async function commitWhatsAppTurn(input: {
  schoolId: string;
  conversationId: string;
  generation: string;
  waId: string;
  phoneNumberId: string;
  wamid: string;
  inboundMessageId: string;
  inboundText: string;
  replyText: string;
  effect: PreparedEffect;
  now: Date;
}) {
  const { data } = await createAdminClient()
    .rpc("commit_whatsapp_turn", {
      p_school_id: input.schoolId,
      p_conversation_id: input.conversationId,
      p_generation: input.generation,
      p_wa_id: input.waId,
      p_phone_number_id: input.phoneNumberId,
      p_wamid: input.wamid,
      p_inbound_id: input.inboundMessageId,
      p_inbound_text: input.inboundText,
      p_reply_id: randomUUID(),
      p_reply_message_id: generateId(),
      p_reply_text: input.replyText,
      p_reply_chunks: splitWhatsAppText(input.replyText),
      p_effect: input.effect,
      p_now: input.now.toISOString(),
    })
    .throwOnError();
  const result = data?.[0];
  if (!result) throw new Error("turn_result_missing");
  return result;
}
