import { z } from "zod";
import { readPoppyJson } from "./conversation-requests";
import { PoppyError, poppyErrorResponse } from "./errors";
import {
  confirmOperation,
  readOperation,
  supportsOperations,
} from "./operations";
import { checkPoppyRequest } from "./protected-request";

export async function poppyOperationEndpoint(
  request: Request,
  schoolId: string,
  id: string,
  action: "read" | "confirm" | "cancel",
) {
  const authorization = await checkPoppyRequest(request, schoolId);
  if (!authorization.ok) return authorization.response;
  if (!supportsOperations(authorization.principal.extensions))
    return Response.json(
      { error: "extension_required", extension: "operations" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  try {
    let body:
      | Awaited<ReturnType<typeof readOperation>>
      | { error: string; operation: Awaited<ReturnType<typeof readOperation>> };
    let status = 200;
    if (action === "confirm") {
      const input = z
        .object({
          revision: z.number().int().positive(),
          approved_by: z.enum(["user", "standing_permission"]),
        })
        .strict()
        .safeParse(await readPoppyJson(request));
      if (!input.success) throw new PoppyError("invalid_request");
      const result = await confirmOperation(
        authorization.principal,
        id,
        input.data,
      );
      if (result.error) {
        body = { error: result.error, operation: result.operation };
        status = 409;
      } else body = result.operation;
    } else
      body = await readOperation(
        authorization.principal,
        id,
        action === "cancel",
      );
    return Response.json(body, {
      status,
      headers: {
        "Cache-Control": "no-store",
        ...("state" in body && body.state === "in_progress"
          ? { "Retry-After": "1" }
          : {}),
      },
    });
  } catch (error) {
    return poppyErrorResponse(error, true);
  }
}
