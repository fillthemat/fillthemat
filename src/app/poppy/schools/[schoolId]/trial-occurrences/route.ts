import { poppyTrialOccurrencesEndpoint } from "@/lib/poppy/booking-api";

export async function GET(
  request: Request,
  { params }: RouteContext<"/poppy/schools/[schoolId]/trial-occurrences">,
) {
  return poppyTrialOccurrencesEndpoint(request, (await params).schoolId);
}
