import { handlePoppyRevocation } from "@/lib/poppy/auth-endpoints";

export async function POST(
  request: Request,
  { params }: RouteContext<"/schools/[schoolId]/revoke">,
) {
  return handlePoppyRevocation(request, (await params).schoolId);
}
