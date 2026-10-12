export class PoppyError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 400,
    public readonly retryAfter?: number,
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
    { error: code },
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
