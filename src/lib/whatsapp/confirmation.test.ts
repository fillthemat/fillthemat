import { describe, expect, it } from "vitest";
import { isAffirmativeConfirmation, parseConfirmBookingButton } from "./confirmation";

describe("parseConfirmBookingButton", () => {
  it("parses a confirm_booking:<id> button reply", () => {
    const id = "a1b2c3d4-0000-0000-0000-000000000000";
    expect(parseConfirmBookingButton(`confirm_booking:${id}`)).toBe(id);
  });

  it("rejects non-confirm button ids and garbage", () => {
    expect(parseConfirmBookingButton("choose_another_time")).toBeNull();
    expect(parseConfirmBookingButton("yes")).toBeNull();
    expect(parseConfirmBookingButton(null)).toBeNull();
    expect(parseConfirmBookingButton("confirm_booking:")).toBeNull();
    expect(parseConfirmBookingButton("confirm_booking:1")).toBeNull();
    expect(parseConfirmBookingButton("confirm_booking:abcdefghijklmnopqrst")).toBeNull();
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
