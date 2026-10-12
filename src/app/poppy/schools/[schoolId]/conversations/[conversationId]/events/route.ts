import { poppyEventsEndpoint } from "@/lib/poppy/conversation-endpoints";

export const maxDuration = 120;
export async function GET(
  request: Request,
  {
    params,
  }: RouteContext<"/poppy/schools/[schoolId]/conversations/[conversationId]/events">,
) {
  const { schoolId, conversationId } = await params;
  return poppyEventsEndpoint(request, schoolId, conversationId);
}
