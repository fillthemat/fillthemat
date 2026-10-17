import { describe, expect, it } from "vitest";
import { bookingStatusVariant, formatBookingStatus, formatEmailState } from "./format";

describe("formatBookingStatus", () => {
  it("uses owner-facing words", () => {
    expect(formatBookingStatus("no_show")).toBe("No-show");
    expect(formatBookingStatus("booked")).toBe("Booked");
    expect(formatBookingStatus("cancelled")).toBe("Cancelled");
  });
});

describe("formatEmailState", () => {
  it("humanizes delivery state", () => {
    expect(formatEmailState("failed")).toBe("Failed");
    expect(formatEmailState(undefined)).toBe("—");
  });
});

describe("bookingStatusVariant", () => {
  it("maps status to a badge variant", () => {
    expect(bookingStatusVariant("showed")).toBe("success");
    expect(bookingStatusVariant("no_show")).toBe("warning");
    expect(bookingStatusVariant("cancelled")).toBe("muted");
  });
});
