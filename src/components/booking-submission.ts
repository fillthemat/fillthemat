const fallback =
  "We could not confirm your booking. Please contact the school before trying again.";
const messages: Record<string, string> = {
  too_large: "Your booking details are too long. Shorten them and try again.",
  invalid: "Check your contact details and select a trial time again.",
  not_found: "This school is no longer available. Contact the school directly.",
  verification_failed: "Please complete the security check again, then retry.",
  rate_limited: "There have been too many booking attempts. Wait a while or contact the school.",
  acknowledged:
    "This participant already has a booking for this trial. Check your confirmation email or contact the school.",
  ineligible:
    "This trial is not suitable for the participant's age. Choose another trial or contact the school.",
  invalid_slot: "This trial time is no longer valid. Select another time.",
  slot_unavailable: "This trial time is no longer available. Select another time.",
  school_not_public: "This school is not accepting online bookings. Contact the school directly.",
  internal_error: fallback,
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function errorMessage(response: Response): Promise<string> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return fallback;
  }
  return messageFromBody(body);
}

function messageFromBody(body: unknown): string {
  if (typeof body !== "object" || body === null) return fallback;
  const code = "error" in body && typeof body.error === "string" ? body.error : "";
  const message = Object.hasOwn(messages, code) ? messages[code] : fallback;
  // Only display the server-owned UUID contract, not arbitrary response prose.
  const reference =
    "requestId" in body && typeof body.requestId === "string" && uuid.test(body.requestId)
      ? body.requestId
      : null;
  return reference ? `${message} Support reference: ${reference}.` : message;
}

export async function submitBooking(options: {
  fetcher?: typeof fetch;
  key: { current: string | null };
  buildBody: (idempotencyKey: string) => unknown;
  setPending: (pending: boolean) => void;
  setError: (error: string | null) => void;
  resetVerification: () => void;
  onBooked: () => void;
}): Promise<void> {
  const fetcher = options.fetcher ?? fetch;
  options.setPending(true);
  options.setError(null);
  let confirmed = false;
  try {
    if (!options.key.current) {
      const response = await fetcher("/api/bookings/key", { method: "POST" });
      if (!response.ok) {
        options.setError(await errorMessage(response));
        return;
      }
      const body: unknown = await response.json();
      if (
        typeof body !== "object" ||
        body === null ||
        !("idempotencyKey" in body) ||
        typeof body.idempotencyKey !== "string" ||
        !uuid.test(body.idempotencyKey)
      ) {
        options.setError(messageFromBody(body));
        return;
      }
      options.key.current = body.idempotencyKey;
    }
    const response = await fetcher("/api/bookings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(options.buildBody(options.key.current)),
    });
    if (!response.ok) {
      options.setError(await errorMessage(response));
      return;
    }
    const booked: unknown = await response.json();
    if (
      typeof booked !== "object" ||
      booked === null ||
      !("bookingId" in booked) ||
      typeof booked.bookingId !== "string" ||
      !booked.bookingId
    ) {
      options.setError(messageFromBody(booked));
      return;
    }
    options.onBooked();
    confirmed = true;
  } catch {
    options.setError(fallback);
  } finally {
    try {
      if (!confirmed) options.resetVerification();
    } finally {
      options.setPending(false);
    }
  }
}
