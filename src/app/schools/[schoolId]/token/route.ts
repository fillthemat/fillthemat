import { handlePoppyToken } from "@/lib/poppy/auth-endpoints";

export async function POST(
  request: Request,
  { params }: RouteContext<"/schools/[schoolId]/token">,
) {
  return handlePoppyToken(request, (await params).schoolId);
}
