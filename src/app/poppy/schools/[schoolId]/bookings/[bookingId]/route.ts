import { poppyBookingStatusEndpoint } from "@/lib/poppy/booking-api";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ schoolId: string; bookingId: string }> },
) {
  const { schoolId, bookingId } = await params;
  return poppyBookingStatusEndpoint(request, schoolId, bookingId);
}
