import { poppyCreateBookingEndpoint } from "@/lib/poppy/booking-api";

export async function POST(
  request: Request,
  { params }: RouteContext<"/poppy/schools/[schoolId]/bookings">,
) {
  return poppyCreateBookingEndpoint(request, (await params).schoolId);
}
