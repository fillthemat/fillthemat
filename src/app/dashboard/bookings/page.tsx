import Link from "next/link";
import { CancelBookingButton } from "@/components/dashboard/cancel-booking-button";
import {
  bookingStatusVariant,
  formatBookingStatus,
  formatBookingWhen,
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
  const params = await searchParams;
  const { filter = "upcoming" } = params;
  const activeFilter = FILTERS.some((item) => item.id === filter) ? filter : "upcoming";
  const statusFilter = resolveStatus(params.status);
  const now = new Date();
  const rows = await loadBookings(activeFilter, statusFilter, now);

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
      <nav aria-label="Booking filters" className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {FILTERS.map((item) => {
            const current = item.id === activeFilter;
            return (
              <Button key={item.id} asChild variant={current ? "secondary" : "ghost"} size="sm">
                <Link href={item.href} aria-current={current ? "page" : undefined}>
                  {item.label}
                </Link>
              </Button>
            );
          })}
        </div>
        {statusFilter ? (
          <p className="flex items-center gap-2 text-sm">
            <Badge variant="outline">Booked only</Badge>
            <Button asChild variant="link" size="sm">
              <Link
                href={`/dashboard/bookings?filter=${activeFilter}`}
                aria-label="Remove Booked only filter"
              >
                Clear
              </Link>
            </Button>
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
                      {booking.participant_name_snapshot} ({booking.participant_age_snapshot})
                    </p>
                    <p className="text-sm text-pretty">{booking.offering_name_snapshot}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatBookingWhen(new Date(booking.start_at), booking.timezone_snapshot)}
                    </p>
                  </div>
                  <Badge variant={bookingStatusVariant(booking.status)}>
                    {formatBookingStatus(booking.status)}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  <ContactLine
                    name={booking.contact_name_snapshot}
                    email={booking.contact_email_snapshot}
                  />
                  <span className="mx-1">·</span>
                  Email {formatEmailState(booking.email_deliveries[0]?.state)}
                </p>
                <BookingActions
                  id={booking.id}
                  status={booking.status}
                  startAt={new Date(booking.start_at)}
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
                    <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                      {formatBookingWhen(new Date(booking.start_at), booking.timezone_snapshot)}
                    </TableCell>
                    <TableCell className="font-medium text-pretty">
                      {booking.participant_name_snapshot} ({booking.participant_age_snapshot})
                    </TableCell>
                    <TableCell className="text-pretty">{booking.offering_name_snapshot}</TableCell>
                    <TableCell>
                      <Badge variant={bookingStatusVariant(booking.status)}>
                        {formatBookingStatus(booking.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <ContactLine
                        name={booking.contact_name_snapshot}
                        email={booking.contact_email_snapshot}
                      />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatEmailState(booking.email_deliveries[0]?.state)}
                    </TableCell>
                    <TableCell>
                      <BookingActions
                        id={booking.id}
                        status={booking.status}
                        startAt={new Date(booking.start_at)}
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
          <a href={`mailto:${email}`} className="underline-offset-4 hover:underline">
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
