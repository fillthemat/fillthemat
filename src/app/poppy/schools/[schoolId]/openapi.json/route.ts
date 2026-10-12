import { readBookingApiDescription } from "@/lib/poppy/booking-api-description";
import { isPoppyOrigin } from "@/lib/poppy/urls";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ schoolId: string }> },
) {
  const { schoolId } = await params;
  const document = isPoppyOrigin(request, "app")
    ? await readBookingApiDescription(schoolId)
    : null;
  return document
    ? Response.json(document, {
        headers: { "Cache-Control": "public, max-age=300" },
      })
    : new Response(null, {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      });
}
