import { readDiscovery } from "@/lib/poppy/discovery";
import { poppyNotFoundResponse } from "@/lib/poppy/errors";
import { isPoppyOrigin } from "@/lib/poppy/urls";

export async function GET(
  request: Request,
  { params }: RouteContext<"/poppy/discovery/[schoolId]/[domain]">,
) {
  if (!isPoppyOrigin(request, "app")) return poppyNotFoundResponse();
  const { schoolId, domain } = await params;
  const result = await readDiscovery(schoolId, domain);
  if (!result) return poppyNotFoundResponse();
  return new Response(result.document, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": result.pending ? "no-store" : "public, max-age=300",
    },
  });
}
