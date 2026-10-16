import { readBookingApiDescription } from "@/lib/poppy/booking-api-description";
import { poppyNotFoundResponse } from "@/lib/poppy/errors";
import { isPoppyOrigin } from "@/lib/poppy/urls";

export async function GET(
  request: Request,
  { params }: RouteContext<"/poppy/schools/[schoolId]/openapi.json">,
) {
  const { schoolId } = await params;
  const document = isPoppyOrigin(request, "app")
    ? await readBookingApiDescription(schoolId)
    : null;
  return document
    ? Response.json(document, {
        headers: { "Cache-Control": "public, max-age=300" },
      })
    : poppyNotFoundResponse();
}
