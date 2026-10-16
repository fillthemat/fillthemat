export type PoppyErrorCode =
  | "not_found"
  | "invalid_client"
  | "invalid_request"
  | "invalid_token"
  | "invalid_grant"
  | "invalid_session"
  | "invalid_dpop_proof"
  | "unsupported_grant_type"
  | "rate_limited"
  | "invalid_cursor"
  | "conversation_not_found"
  | "conversation_closed"
  | "direct_conversation_open"
  | "message_id_conflict"
  | "extension_required"
  | "operation_not_found"
  | "user_approval_required"
  | "booking_not_found"
  | "slot_unavailable"
  | "ineligible_age";

export function poppyNotFoundResponse() {
  return new Response(null, {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}

export class PoppyError extends Error {
  constructor(
    public readonly code: PoppyErrorCode,
    public readonly status = 400,
    public readonly retryAfter?: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(code);
  }
}

export function poppyErrorResponse(
  error: unknown,
  protectedRequest = false,
): Response {
  if (!(error instanceof PoppyError)) {
    // Do not include assertion, token, User ID or untrusted network errors in logs.
    console.error(JSON.stringify({ event: "poppy_request_failed" }));
  }
  const code = error instanceof PoppyError ? error.code : "server_error";
  const status = error instanceof PoppyError ? error.status : 503;
  return Response.json(
    { error: code, ...(error instanceof PoppyError ? error.details : {}) },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        ...(error instanceof PoppyError && error.retryAfter !== undefined
          ? { "Retry-After": String(error.retryAfter) }
          : {}),
        ...(protectedRequest && status === 401
          ? { "WWW-Authenticate": `DPoP error="${code}"` }
          : {}),
      },
    },
  );
}
