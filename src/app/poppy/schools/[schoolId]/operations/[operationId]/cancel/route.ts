import { poppyOperationEndpoint } from "@/lib/poppy/operation-endpoints";

export async function POST(
  request: Request,
  context: RouteContext<"/poppy/schools/[schoolId]/operations/[operationId]/cancel">,
) {
  const { schoolId, operationId } = await context.params;
  return poppyOperationEndpoint(request, schoolId, operationId, "cancel");
}
