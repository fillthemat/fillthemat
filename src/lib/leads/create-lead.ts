import type { Channel } from "@/lib/channel";
import { hashToken, hashWaId } from "@/lib/crypto";
import { recipientQuotaExceeded } from "@/lib/security/limits";
import { createAdminClient } from "@/lib/supabase/admin";

export type CreateLeadContact = {
  name: string;
  email: string | null;
  phone: string;
};

type LeadSourceDetails = {
  web: { landingSessionToken: string | undefined };
  whatsapp: { waId: string };
};

export type CreateLeadSource = {
  [C in Channel]: { channel: C } & LeadSourceDetails[C];
}[Channel];

export type CreateLeadInput = {
  school: { id: string };
  contact: CreateLeadContact;
  source: CreateLeadSource;
  participantName?: string | null;
  participantAge?: number | null;
  offeringId?: string | null;
  statedNeed?: string | null;
};

export async function ownerLeadQuotaExceeded(schoolId: string) {
  const { data, error } = await createAdminClient()
    .from("school_settings")
    .select("notification_email")
    .eq("school_id", schoolId)
    .single();
  if (error) throw error;
  return recipientQuotaExceeded(schoolId, data.notification_email);
}

/** Atomic public-stack write; SQL callers compose create_lead in their own transaction. */
export async function createLead(input: CreateLeadInput) {
  const landingHash =
    input.source.channel === "whatsapp"
      ? hashWaId(`whatsapp-landing:${input.source.waId}`)
      : input.source.landingSessionToken
        ? hashToken(input.source.landingSessionToken)
        : "";
  const { data, error } = await createAdminClient().rpc("create_lead", {
    p_school_id: input.school.id,
    p_contact_name: input.contact.name,
    p_phone: input.contact.phone,
    p_email: input.contact.email ?? undefined,
    p_channel: input.source.channel,
    p_landing_token_hash: landingHash,
    p_participant_name: input.participantName ?? undefined,
    p_participant_age: input.participantAge ?? undefined,
    p_offering_id: input.offeringId ?? undefined,
    p_stated_need: input.statedNeed ?? undefined,
  });
  if (error) {
    if (error.code === "P0001" && error.message === "session_required") {
      throw Object.assign(new Error("session_required"), { code: "session_required" });
    }
    throw error;
  }
  if (!data) throw new Error("lead_failed");
  return data;
}
