import { issuerMetadata } from "@/lib/poppy/issuer";
import { isPoppyOrigin } from "@/lib/poppy/urls";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ schoolId: string }> },
) {
  if (!isPoppyOrigin(request, "auth"))
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  const { schoolId } = await params;
  const metadata = await issuerMetadata(schoolId);
  return metadata
    ? Response.json(metadata, {
        headers: { "Cache-Control": "public, max-age=300" },
      })
    : new Response(null, {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      });
}
