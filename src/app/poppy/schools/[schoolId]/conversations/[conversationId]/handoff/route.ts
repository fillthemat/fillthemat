import { poppyHandoffEndpoint } from "@/lib/poppy/conversation-endpoints";

export const maxDuration = 120;
export async function POST(
  request: Request,
  {
    params,
  }: RouteContext<"/poppy/schools/[schoolId]/conversations/[conversationId]/handoff">,
) {
  const { schoolId, conversationId } = await params;
  return poppyHandoffEndpoint(request, schoolId, conversationId);
}
