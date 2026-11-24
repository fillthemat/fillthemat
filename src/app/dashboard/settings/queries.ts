import "server-only";
import { createClient } from "@/lib/supabase/server";

export async function loadWhatsAppConnection(schoolId: string) {
  const { data, error } = await (
    await createClient()
  )
    .from("whatsapp_connections")
    .select("state, display_phone_number, failure_code, updated_at")
    .eq("school_id", schoolId)
    .maybeSingle();
  if (error) throw error;
  return data
    ? {
        ...data,
        registeringStale:
          data.state === "registering" && Date.parse(data.updated_at) < Date.now() - 10 * 60_000,
      }
    : null;
}

export async function loadOfferings(schoolId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("trial_offerings")
    .select("*")
    .eq("school_id", schoolId)
    .order("created_at");
  if (error) throw error;
  return data;
}

export async function loadFaqs(schoolId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("faqs")
    .select("*")
    .eq("school_id", schoolId)
    .order("sort_order")
    .order("created_at");
  if (error) throw error;
  return data;
}

export async function loadWindows(schoolId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_settings_windows", { p_school_id: schoolId });
  if (error) throw error;
  return data;
}
