"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { bookings, funnelEvents } from "@/db/schema";
import { requireOwnedSchool } from "@/lib/auth/current-school";
import { attemptPendingForBooking } from "@/lib/email/deliveries";
import { FUNNEL_EVENTS } from "@/lib/funnel";
import { cancelBooking } from "@/lib/schedule/book-slot";

export async function updateAttendanceAction(formData: FormData) {
  const { school } = await requireOwnedSchool();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status"));
  if (status !== "showed" && status !== "no_show") return;
  const db = getDb();
  const updated = await db
    .update(bookings)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(bookings.id, id),
        eq(bookings.schoolId, school.id),
        inArray(bookings.status, ["booked", "showed", "no_show"]),
      ),
    )
    .returning();
  if (updated[0]) {
    await db.insert(funnelEvents).values({
      schoolId: school.id,
      bookingId: id,
      eventType: status === "showed" ? FUNNEL_EVENTS.showed : FUNNEL_EVENTS.noShow,
    });
  }
  revalidatePath("/dashboard/bookings");
}

export async function cancelBookingAction(formData: FormData) {
  const { school } = await requireOwnedSchool();
  const id = String(formData.get("id") ?? "");
  const result = await cancelBooking({ schoolId: school.id, bookingId: id });
  if (result.ok && !result.replay) {
    await attemptPendingForBooking(id);
  }
  revalidatePath("/dashboard/bookings");
}
