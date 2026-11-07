"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { requireSchool } from "@/lib/auth/current-school";
import { attemptPendingForBooking } from "@/lib/email/deliveries";
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
  const { data, error } = await supabase.rpc("cancel_dashboard_booking", { p_booking_id: id });
  if (error) throw error;
  // Cancellation emails are queued atomically in public.email_deliveries.
  if (data === "cancelled") {
    after(async () => {
      try {
        await attemptPendingForBooking(id);
      } catch (error) {
        // The durable outbox recovers independently; email must not fail cancellation.
        console.error(
          JSON.stringify({
            event: "booking_cancellation_email_attempt_failed",
            bookingId: id,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    });
  }
  revalidatePath("/dashboard/bookings");
  revalidatePath("/dashboard");
}
