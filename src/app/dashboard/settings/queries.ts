import "server-only";
import { createClient } from "@/lib/supabase/server";

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
