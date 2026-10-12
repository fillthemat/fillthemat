import { and, desc, eq, gte, lt } from "drizzle-orm";
import { getDb } from "@/db";
import { bookings } from "@/db/schema";

export function loadBookings({
  schoolId,
  filter,
  status,
  now = new Date(),
}: {
  schoolId: string;
  filter: string;
  status?: "booked" | null;
  now?: Date;
}) {
  return getDb()
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.schoolId, schoolId),
        filter === "upcoming"
          ? gte(bookings.startAt, now)
          : filter === "past"
            ? lt(bookings.startAt, now)
            : undefined,
        status ? eq(bookings.status, status) : undefined,
      ),
    )
    .orderBy(desc(bookings.startAt));
}
