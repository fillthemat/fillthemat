import { describe, expect, it } from "vitest";
import {
  bookingConfirmationIdempotencyKey,
  confirmBookingButtonId,
  isAffirmativeConfirmation,
  parseConfirmBookingButton,
} from "./confirmation";

describe("parseConfirmBookingButton", () => {
  it("parses a confirm_booking:<id> button reply", () => {
    const id = "a1b2c3d4-0000-0000-0000-000000000000";
    expect(parseConfirmBookingButton(confirmBookingButtonId(id))).toBe(id);
  });

  it("rejects non-confirm button ids and garbage", () => {
    expect(parseConfirmBookingButton("choose_another_time")).toBeNull();
    expect(parseConfirmBookingButton("yes")).toBeNull();
    expect(parseConfirmBookingButton(null)).toBeNull();
    expect(parseConfirmBookingButton("confirm_booking:")).toBeNull();
  });
});

describe("isAffirmativeConfirmation", () => {
  it("accepts the exact affirmative tokens case-insensitively", () => {
    for (const answer of ["yes", "Confirm", "YEP", "ok", " sure "]) {
      expect(isAffirmativeConfirmation(answer)).toBe(true);
    }
  });

  it("rejects anything else", () => {
    for (const answer of ["yess", "no", "book it please", "", null, "confirm the 4pm slot"]) {
      expect(isAffirmativeConfirmation(answer)).toBe(false);
    }
  });
});

describe("bookingConfirmationIdempotencyKey", () => {
  it("is deterministic and a valid v5-format UUID", () => {
    const a = bookingConfirmationIdempotencyKey("school-1", "wamid.123");
    const b = bookingConfirmationIdempotencyKey("school-1", "wamid.123");
    const c = bookingConfirmationIdempotencyKey("school-1", "wamid.456");
    const d = bookingConfirmationIdempotencyKey("school-2", "wamid.123");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});
