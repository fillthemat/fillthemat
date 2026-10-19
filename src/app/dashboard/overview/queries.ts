import "server-only";
import { cache } from "react";
import { requireSchool } from "@/lib/auth/current-school";
import { createClient } from "@/lib/supabase/server";

export const loadOverviewMetrics = cache(async () => {
  const { school } = await requireSchool();
  const supabase = await createClient();

  const { data, error } = await supabase
    .rpc("get_overview_metrics", { p_school_id: school.id })
    .single();

  if (error) throw error;

  return data;
});
