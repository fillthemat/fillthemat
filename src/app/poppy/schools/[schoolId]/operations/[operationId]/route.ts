import { poppyOperationEndpoint } from "@/lib/poppy/operation-endpoints";

export async function GET(
  request: Request,
  context: RouteContext<"/poppy/schools/[schoolId]/operations/[operationId]">,
) {
  const { schoolId, operationId } = await context.params;
  return poppyOperationEndpoint(request, schoolId, operationId, "read");
}
