"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSchool } from "@/lib/auth/current-school";
import { createClient } from "@/lib/supabase/server";

export async function updateAttendanceAction(formData: FormData) {
  await requireSchool();
  const id = z.uuid().parse(formData.get("id"));
  const status = String(formData.get("status"));
  if (status !== "showed" && status !== "no_show") return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_booking_attendance", {
    p_booking_id: id,
    p_status: status,
  });
  if (error) throw error;
  revalidatePath("/dashboard/bookings");
  revalidatePath("/dashboard");
}

export async function cancelBookingAction(formData: FormData) {
  await requireSchool();
  const id = z.uuid().parse(formData.get("id"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_dashboard_booking", { p_booking_id: id });
  if (error) throw error;
  // Cancellation emails are queued atomically in public.email_deliveries.
  // The legacy app-schema dispatcher must not be used for these rows.
  revalidatePath("/dashboard/bookings");
  revalidatePath("/dashboard");
}
