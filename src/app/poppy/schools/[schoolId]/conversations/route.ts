import { poppyMessageEndpoint } from "@/lib/poppy/conversation-endpoints";

export const maxDuration = 120;
export async function POST(
  request: Request,
  { params }: RouteContext<"/poppy/schools/[schoolId]/conversations">,
) {
  const { schoolId } = await params;
  return poppyMessageEndpoint(request, schoolId);
}
