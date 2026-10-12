import { poppyTrialOccurrencesEndpoint } from "@/lib/poppy/booking-api";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ schoolId: string }> },
) {
  return poppyTrialOccurrencesEndpoint(request, (await params).schoolId);
}
