import { formatInTimeZone } from "date-fns-tz";
import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { readBookingCancellation } from "@/lib/poppy/booking-cancellation";
import { cancelPersonalAgentBookingAction } from "./actions";

export const metadata: Metadata = {
  title: "Cancel a Personal-Agent booking",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function CancelPage({
  params,
  searchParams,
}: {
  params: Promise<{ bookingId: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const [{ bookingId }, query] = await Promise.all([params, searchParams]);
  const token = typeof query.token === "string" ? query.token : "";
  const booking = await readBookingCancellation(bookingId, token);
  return (
    <main className="mx-auto max-w-lg space-y-6 px-6 py-16">
      <h1 className="text-2xl font-semibold">
        {booking ? "Not you?" : "Cancel link unavailable"}
      </h1>
      {booking ? (
        <>
          <p>
            A Personal Agent booked this trial in your name. Nothing has been
            cancelled yet.
          </p>
          <p>
            {booking.offeringNameSnapshot} for {booking.participantNameSnapshot}
            ,{" "}
            {formatInTimeZone(
              booking.startAt,
              booking.timezoneSnapshot,
              "EEEE, MMMM d, yyyy 'at' h:mm a zzz",
            )}
            .
          </p>
          <p>
            If you did not approve this booking, confirm below to cancel only
            this trial. No account is needed.
          </p>
          <form action={cancelPersonalAgentBookingAction.bind(null, bookingId)}>
            <input type="hidden" name="token" value={token} />
            <Button type="submit" variant="destructive">
              Cancel this booking
            </Button>
          </form>
        </>
      ) : (
        <p>
          This link is invalid, has already been used, or the trial can no
          longer be cancelled. Contact the school using the details in your
          confirmation email.
        </p>
      )}
    </main>
  );
}
