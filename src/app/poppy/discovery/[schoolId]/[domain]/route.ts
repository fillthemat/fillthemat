import { readDiscovery } from "@/lib/poppy/discovery";
import { isPoppyOrigin } from "@/lib/poppy/urls";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ schoolId: string; domain: string }> },
) {
  if (!isPoppyOrigin(request, "app"))
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  const { schoolId, domain } = await params;
  const result = await readDiscovery(schoolId, domain);
  if (!result)
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  return new Response(result.document, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": result.pending ? "no-store" : "public, max-age=300",
    },
  });
}
