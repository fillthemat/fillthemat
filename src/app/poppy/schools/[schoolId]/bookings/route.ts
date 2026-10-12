import { poppyCreateBookingEndpoint } from "@/lib/poppy/booking-api";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ schoolId: string }> },
) {
  return poppyCreateBookingEndpoint(request, (await params).schoolId);
}
