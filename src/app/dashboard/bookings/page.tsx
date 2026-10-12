import { eq } from "drizzle-orm";
import Link from "next/link";
import { CancelBookingButton } from "@/components/dashboard/cancel-booking-button";
import {
  bookingStatusVariant,
  formatBookingStatus,
  formatBookingWhen,
  formatChannel,
  formatEmailState,
} from "@/components/dashboard/format";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getDb } from "@/db";
import { emailDeliveries } from "@/db/schema";
import { requireOwnedSchool } from "@/lib/auth/current-school";
import { cn } from "@/lib/utils";
import { updateAttendanceAction } from "./actions";
import { loadBookings } from "./queries";

const FILTERS = [
  {
    id: "upcoming",
    label: "Upcoming",
    href: "/dashboard/bookings?filter=upcoming",
  },
  { id: "past", label: "Past", href: "/dashboard/bookings?filter=past" },
  { id: "all", label: "All", href: "/dashboard/bookings?filter=all" },
] as const;

function resolveStatus(value: unknown): "booked" | null {
  return value === "booked" ? "booked" : null;
}

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; status?: string }>;
}) {
  const { school } = await requireOwnedSchool();
  const params = await searchParams;
  const { filter = "upcoming" } = params;
  const activeFilter = FILTERS.some((item) => item.id === filter)
    ? filter
    : "upcoming";
  const statusFilter = resolveStatus(params.status);
  const db = getDb();
  const now = new Date();
  const rows = await loadBookings({
    schoolId: school.id,
    filter: activeFilter,
    status: statusFilter,
    now,
  });

  const deliveries = await db
    .select()
    .from(emailDeliveries)
    .where(eq(emailDeliveries.schoolId, school.id));
  const deliveryByBooking = new Map<string, string>();
  for (const delivery of deliveries) {
    if (delivery.bookingId) {
      deliveryByBooking.set(delivery.bookingId, delivery.state);
    }
  }

  const emptyLabel = statusFilter
    ? activeFilter === "upcoming"
      ? "No upcoming booked reservations."
      : activeFilter === "past"
        ? "No past booked reservations."
        : "No booked reservations."
    : activeFilter === "upcoming"
      ? "No upcoming bookings."
      : activeFilter === "past"
        ? "No past bookings."
        : "No bookings yet.";

  return (
    <main id="main-content" className="flex flex-col gap-4">
      <PageHeader title="Bookings" />
      <nav
        aria-label="Booking filters"
        className="flex flex-wrap items-center gap-2"
      >
        <div className="flex gap-1">
          {FILTERS.map((item) => {
            const current = item.id === activeFilter;
            return (
              <Link
                key={item.id}
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "rounded-full px-3 py-1.5 text-sm",
                  current
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
        {statusFilter ? (
          <p className="flex items-center gap-2 text-sm">
            <Badge variant="outline">Booked only</Badge>
            <Link
              href={`/dashboard/bookings?filter=${activeFilter}`}
              className="text-muted-foreground underline-offset-4 hover:underline"
              aria-label="Remove Booked only filter"
            >
              Clear
            </Link>
          </p>
        ) : null}
      </nav>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-border md:hidden">
            {rows.map((booking) => (
              <li key={booking.id} className="flex flex-col gap-2 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-pretty">
                      {booking.participantNameSnapshot} (
                      {booking.participantAgeSnapshot})
                    </p>
                    <p className="text-sm text-pretty">
                      {booking.offeringNameSnapshot}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatBookingWhen(
                        booking.startAt,
                        booking.timezoneSnapshot,
                      )}
                    </p>
                  </div>
                  <Badge variant={bookingStatusVariant(booking.status)}>
                    {formatBookingStatus(booking.status)}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Channel: {formatChannel(booking.channel)}
                  {booking.channel === "poppy" && booking.poppyClientDisplayName
                    ? ` · ${booking.poppyClientDisplayName}`
                    : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  <ContactLine
                    name={booking.contactNameSnapshot}
                    email={booking.contactEmailSnapshot}
                  />
                  <span className="mx-1">·</span>
                  Email {formatEmailState(deliveryByBooking.get(booking.id))}
                </p>
                <BookingActions
                  id={booking.id}
                  status={booking.status}
                  startAt={booking.startAt}
                  now={now}
                />
              </li>
            ))}
          </ul>

          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Participant</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((booking) => (
                  <TableRow key={booking.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatBookingWhen(
                        booking.startAt,
                        booking.timezoneSnapshot,
                      )}
                    </TableCell>
                    <TableCell className="font-medium text-pretty">
                      {booking.participantNameSnapshot} (
                      {booking.participantAgeSnapshot})
                    </TableCell>
                    <TableCell className="text-pretty">
                      {booking.offeringNameSnapshot}
                    </TableCell>
                    <TableCell>
                      <Badge variant={bookingStatusVariant(booking.status)}>
                        {formatBookingStatus(booking.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatChannel(booking.channel)}
                      {booking.channel === "poppy" &&
                      booking.poppyClientDisplayName
                        ? ` · ${booking.poppyClientDisplayName}`
                        : ""}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <ContactLine
                        name={booking.contactNameSnapshot}
                        email={booking.contactEmailSnapshot}
                      />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatEmailState(deliveryByBooking.get(booking.id))}
                    </TableCell>
                    <TableCell>
                      <BookingActions
                        id={booking.id}
                        status={booking.status}
                        startAt={booking.startAt}
                        now={now}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </main>
  );
}

function ContactLine({ name, email }: { name: string; email: string | null }) {
  return (
    <span className="break-all">
      {name}
      {email ? (
        <>
          {" · "}
          <a
            href={`mailto:${email}`}
            className="underline-offset-4 hover:underline"
          >
            {email}
          </a>
        </>
      ) : null}
    </span>
  );
}

function BookingActions({
  id,
  status,
  startAt,
  now,
}: {
  id: string;
  status: string;
  startAt: Date;
  now: Date;
}) {
  const canAttend = status !== "cancelled";
  const canCancel = status === "booked" && startAt > now;
  if (!canAttend && !canCancel) return null;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {canAttend ? (
        <>
          <form action={updateAttendanceAction}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="status" value="showed" />
            <Button type="submit" variant="outline" size="sm">
              Showed
            </Button>
          </form>
          <form action={updateAttendanceAction}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="status" value="no_show" />
            <Button type="submit" variant="outline" size="sm">
              No-show
            </Button>
          </form>
        </>
      ) : null}
      {canCancel ? <CancelBookingButton bookingId={id} /> : null}
    </div>
  );
}
