import { expect, it, vi } from "vitest";
import { submitBooking } from "./booking-submission";

const key = "00000000-0000-4000-8000-000000000001";
const reference = "00000000-0000-4000-8000-000000000002";
const fallback =
  "We could not confirm your booking. Please contact the school before trying again.";

function setup(fetcher = vi.fn()) {
  const options = {
    fetcher,
    key: { current: null as string | null },
    buildBody: vi.fn((idempotencyKey: string) => ({ idempotencyKey })),
    setPending: vi.fn(),
    setError: vi.fn(),
    onBooked: vi.fn(),
  };
  return options;
}

it("shows an unexpected booking failure's server reference and restores pending state", async () => {
  const options = setup();
  options.fetcher
    .mockResolvedValueOnce(
      Response.json({ idempotencyKey: "00000000-0000-4000-8000-000000000001" }),
    )
    .mockResolvedValueOnce(
      Response.json(
        {
          error: "internal_error",
          requestId: "00000000-0000-4000-8000-000000000002",
        },
        { status: 500 },
      ),
    );
  await submitBooking(options);
  expect(options.setError).toHaveBeenLastCalledWith(
    "We could not confirm your booking. Please contact the school before trying again. Support reference: 00000000-0000-4000-8000-000000000002.",
  );
  expect(options.setPending.mock.calls).toEqual([[true], [false]]);
  expect(options.onBooked).not.toHaveBeenCalled();
});

it.each([
  ["too_large", "Shorten"],
  ["invalid", "contact details"],
  ["not_found", "no longer available"],
  ["verification_failed", "security check"],
  ["rate_limited", "Wait a while"],
  ["acknowledged", "already has a booking"],
  ["ineligible", "participant's age"],
  ["invalid_slot", "Select another time"],
  ["slot_unavailable", "Select another time"],
  ["school_not_public", "not accepting online bookings"],
  ["internal_error", "contact the school before trying again"],
])(
  "maps %s to actionable copy with a support reference",
  async (code, copy) => {
    const options = setup();
    options.key.current = key;
    options.fetcher.mockResolvedValue(
      Response.json({ error: code, requestId: reference }, { status: 400 }),
    );
    await submitBooking(options);
    expect(options.setError).toHaveBeenLastCalledWith(
      expect.stringContaining(copy),
    );
    expect(options.setError).toHaveBeenLastCalledWith(
      expect.stringContaining(`Support reference: ${reference}.`),
    );
    expect(options.onBooked).not.toHaveBeenCalled();
    expect(options.setPending).toHaveBeenLastCalledWith(false);
  },
);

it.each(["unknown", "constructor", "__proto__"])(
  "uses safe fallback for code %s",
  async (error) => {
    const options = setup();
    options.key.current = key;
    options.fetcher.mockResolvedValue(
      Response.json(
        { error, requestId: reference, message: "SENTINEL_SQL" },
        { status: 500 },
      ),
    );
    await submitBooking(options);
    expect(options.setError).toHaveBeenLastCalledWith(
      `${fallback} Support reference: ${reference}.`,
    );
  },
);

it.each(["key", "booking"])(
  "handles a failed %s request without proceeding or calling success",
  async (stage) => {
    const options = setup();
    if (stage === "booking") options.key.current = key;
    options.fetcher.mockResolvedValue(
      Response.json(
        { error: "rate_limited", requestId: reference },
        { status: 429 },
      ),
    );
    await submitBooking(options);
    expect(options.fetcher).toHaveBeenCalledTimes(1);
    expect(options.onBooked).not.toHaveBeenCalled();
    expect(options.setError).toHaveBeenLastCalledWith(
      expect.stringContaining(reference),
    );
    expect(options.setPending).toHaveBeenLastCalledWith(false);
  },
);

it.each(["key", "booking"])(
  "catches %s network failures and never fabricates a reference",
  async (stage) => {
    const options = setup();
    if (stage === "booking") options.key.current = key;
    options.fetcher.mockRejectedValue(new Error("SENTINEL_SECRET"));
    await submitBooking(options);
    expect(options.setError).toHaveBeenLastCalledWith(fallback);
    expect(options.setPending.mock.calls).toEqual([[true], [false]]);
    expect(options.onBooked).not.toHaveBeenCalled();
  },
);

it.each([
  null,
  {},
  { idempotencyKey: "SENTINEL_KEY" },
  { idempotencyKey: 123 },
])("rejects invalid key response %j", async (body) => {
  const options = setup();
  options.fetcher.mockResolvedValue(Response.json(body));
  await submitBooking(options);
  expect(options.fetcher).toHaveBeenCalledTimes(1);
  expect(options.key.current).toBeNull();
  expect(options.buildBody).not.toHaveBeenCalled();
  expect(options.setError).toHaveBeenLastCalledWith(fallback);
  expect(options.setPending).toHaveBeenLastCalledWith(false);
  expect(options.onBooked).not.toHaveBeenCalled();
});

it.each(["key_success", "key_error", "booking_error"])(
  "handles non-JSON %s bodies safely",
  async (stage) => {
    const options = setup();
    if (stage === "booking_error") options.key.current = key;
    options.fetcher.mockResolvedValue(
      new Response("SENTINEL_PROVIDER", {
        status: stage === "key_success" ? 200 : 500,
      }),
    );
    await submitBooking(options);
    expect(options.setError).toHaveBeenLastCalledWith(fallback);
    expect(options.setPending).toHaveBeenLastCalledWith(false);
    expect(options.onBooked).not.toHaveBeenCalled();
    expect(options.fetcher).toHaveBeenCalledTimes(1);
  },
);

it.each([
  null,
  [],
  { error: 1 },
  { error: "unknown", requestId: "SENTINEL_SECRET" },
])("handles malformed error envelope %j", async (body) => {
  const options = setup();
  options.key.current = key;
  options.fetcher.mockResolvedValue(Response.json(body, { status: 500 }));
  await submitBooking(options);
  expect(options.setError).toHaveBeenLastCalledWith(fallback);
  expect(options.onBooked).not.toHaveBeenCalled();
});

it("reuses the same idempotency key when retrying an uncertain network outcome", async () => {
  const options = setup();
  options.fetcher
    .mockResolvedValueOnce(Response.json({ idempotencyKey: key }))
    .mockRejectedValueOnce(new Error("network interrupted"))
    .mockResolvedValueOnce(
      Response.json({ bookingId: "booking-id", idempotent: true }),
    );
  await submitBooking(options);
  expect(options.onBooked).not.toHaveBeenCalled();
  await submitBooking(options);
  expect(options.fetcher.mock.calls.map(([url]) => url)).toEqual([
    "/api/bookings/key",
    "/api/bookings",
    "/api/bookings",
  ]);
  expect(options.buildBody.mock.calls).toEqual([[key], [key]]);
  expect(options.onBooked).toHaveBeenCalledTimes(1);
  expect(options.setPending.mock.calls).toEqual([
    [true],
    [false],
    [true],
    [false],
  ]);
});

it("calls success only after both successful requests", async () => {
  const options = setup();
  options.fetcher
    .mockResolvedValueOnce(Response.json({ idempotencyKey: key }))
    .mockResolvedValueOnce(Response.json({ bookingId: "booking-id" }));
  await submitBooking(options);
  expect(options.onBooked).toHaveBeenCalledTimes(1);
  expect(options.setError.mock.calls).toEqual([[null]]);
  expect(options.setPending).toHaveBeenLastCalledWith(false);
});

it.each(["not-json", "null", "{}"])(
  "does not claim success for malformed booking success body %s",
  async (body) => {
    const options = setup();
    options.key.current = key;
    options.fetcher.mockResolvedValue(new Response(body, { status: 200 }));
    await submitBooking(options);
    expect(options.onBooked).not.toHaveBeenCalled();
    expect(options.setError).toHaveBeenLastCalledWith(fallback);
    expect(options.setPending).toHaveBeenLastCalledWith(false);
  },
);

it("preserves a provided reference on an invalid key response", async () => {
  const options = setup();
  options.fetcher.mockResolvedValue(
    Response.json({ idempotencyKey: "invalid", requestId: reference }),
  );
  await submitBooking(options);
  expect(options.setError).toHaveBeenLastCalledWith(
    `${fallback} Support reference: ${reference}.`,
  );
  expect(options.fetcher).toHaveBeenCalledTimes(1);
  expect(options.onBooked).not.toHaveBeenCalled();
});
