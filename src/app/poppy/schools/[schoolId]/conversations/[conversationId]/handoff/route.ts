import { poppyHandoffEndpoint } from "@/lib/poppy/conversation-endpoints";

export const maxDuration = 120;
export async function POST(
  request: Request,
  { params }: { params: Promise<{ schoolId: string; conversationId: string }> },
) {
  const { schoolId, conversationId } = await params;
  return poppyHandoffEndpoint(request, schoolId, conversationId);
}
