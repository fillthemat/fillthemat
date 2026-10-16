import { poppyCloseEndpoint } from "@/lib/poppy/conversation-endpoints";

export const maxDuration = 120;
export async function POST(
  request: Request,
  {
    params,
  }: RouteContext<"/poppy/schools/[schoolId]/conversations/[conversationId]/close">,
) {
  const { schoolId, conversationId } = await params;
  return poppyCloseEndpoint(request, schoolId, conversationId);
}
