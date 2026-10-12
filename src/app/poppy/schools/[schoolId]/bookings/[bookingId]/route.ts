import { poppyBookingStatusEndpoint } from "@/lib/poppy/booking-api";

export async function GET(
  request: Request,
  { params }: RouteContext<"/poppy/schools/[schoolId]/bookings/[bookingId]">,
) {
  const { schoolId, bookingId } = await params;
  return poppyBookingStatusEndpoint(request, schoolId, bookingId);
}
