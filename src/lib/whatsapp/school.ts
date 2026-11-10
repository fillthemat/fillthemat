import "server-only";
import { InternalFailure } from "@/lib/retry-policy";
import { createAdminClient } from "@/lib/supabase/admin";

/** Trusted worker lookup; private instructions never enter public-school reads. */
export async function loadWhatsAppSchool(schoolId: string) {
  const { data } = await createAdminClient()
    .from("schools")
    .select("*, school_profiles!inner(*), school_settings!inner(agent_instructions)")
    .eq("id", schoolId)
    .maybeSingle()
    .throwOnError();
  if (!data) throw new InternalFailure("school_missing");
  if (!data.approved_at || !data.published_at) throw new InternalFailure("school_not_approved");
  const profile = data.school_profiles;
  return {
    id: data.id,
    timezone: data.timezone,
    name: profile.name,
    city: profile.city,
    address: profile.address,
    phone: profile.phone,
    website: profile.website,
    parkingNotes: profile.parking_notes,
    accessNotes: profile.access_notes,
    trialGuidance: profile.trial_guidance,
    pricing: profile.pricing,
    welcomeMessage: profile.welcome_message,
    agentInstructions: data.school_settings.agent_instructions,
  };
}
