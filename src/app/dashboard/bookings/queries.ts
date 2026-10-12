import { and, desc, eq, getTableColumns, gte, lt } from "drizzle-orm";
import { getDb } from "@/db";
import { bookings, poppyClients } from "@/db/schema";

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
    .select({
      ...getTableColumns(bookings),
      poppyClientDisplayName: poppyClients.displayName,
    })
    .from(bookings)
    .leftJoin(poppyClients, eq(bookings.poppyClientId, poppyClients.clientId))
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
