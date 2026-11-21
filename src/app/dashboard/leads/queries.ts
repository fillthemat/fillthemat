import "server-only";
import { requireSchool } from "@/lib/auth/current-school";
import { createClient } from "@/lib/supabase/server";

export async function loadLeads() {
  const { school } = await requireSchool();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .select(
      "id, participant_name, participant_age, stated_need, created_at, contacts!inner(name, email, phone)",
    )
    .eq("school_id", school.id)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return { leads: data, timezone: school.timezone };
}
