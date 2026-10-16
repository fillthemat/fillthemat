import { poppyNotFoundResponse } from "@/lib/poppy/errors";
import { issuerMetadata } from "@/lib/poppy/issuer";
import { isPoppyOrigin } from "@/lib/poppy/urls";

export async function GET(
  request: Request,
  {
    params,
  }: RouteContext<"/.well-known/oauth-authorization-server/schools/[schoolId]">,
) {
  if (!isPoppyOrigin(request, "auth")) return poppyNotFoundResponse();
  const { schoolId } = await params;
  const metadata = await issuerMetadata(schoolId);
  return metadata
    ? Response.json(metadata, {
        headers: { "Cache-Control": "public, max-age=300" },
      })
    : poppyNotFoundResponse();
}
