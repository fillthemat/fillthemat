"use server";

import { redirect } from "next/navigation";
import { attemptPendingForBooking } from "@/lib/email/deliveries";
import { cancelBookingWithToken } from "@/lib/poppy/booking-cancellation";

export async function cancelPersonalAgentBookingAction(
  bookingId: string,
  formData: FormData,
) {
  const token = formData.get("token");
  const result = await cancelBookingWithToken(
    bookingId,
    typeof token === "string" ? token : "",
  );
  if (!result.ok) redirect("/poppy/bookings/cancel-unavailable");
  // The usual durable outbox retries any failed email; a send failure must not
  // disguise the cancellation that has already committed.
  try {
    await attemptPendingForBooking(bookingId);
  } catch {
    console.error(
      JSON.stringify({ event: "poppy_cancellation_email_degraded", bookingId }),
    );
  }
  redirect("/poppy/bookings/cancelled");
}
