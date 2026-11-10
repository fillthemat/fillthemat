import "server-only";
import { requireSchool } from "@/lib/auth/current-school";
import { createClient } from "@/lib/supabase/server";

export async function loadBookings(filter: string, status: "booked" | null, now: Date) {
  const { school } = await requireSchool();
  const supabase = await createClient();
  let query = supabase
    .from("bookings")
    .select(
      "id, status, start_at, timezone_snapshot, participant_name_snapshot, participant_age_snapshot, offering_name_snapshot, contact_name_snapshot, contact_email_snapshot, email_deliveries(state, created_at)",
    )
    .eq("school_id", school.id)
    .order("start_at", { ascending: false })
    .order("created_at", { referencedTable: "email_deliveries", ascending: false })
    .limit(1, { referencedTable: "email_deliveries" });

  if (filter === "upcoming") query = query.gte("start_at", now.toISOString());
  if (filter === "past") query = query.lt("start_at", now.toISOString());
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}
