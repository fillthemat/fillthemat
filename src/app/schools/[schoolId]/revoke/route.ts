import { handlePoppyRevocation } from "@/lib/poppy/auth-endpoints";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ schoolId: string }> },
) {
  return handlePoppyRevocation(request, (await params).schoolId);
}
