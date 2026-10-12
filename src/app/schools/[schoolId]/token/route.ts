import { handlePoppyToken } from "@/lib/poppy/auth-endpoints";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ schoolId: string }> },
) {
  return handlePoppyToken(request, (await params).schoolId);
}
