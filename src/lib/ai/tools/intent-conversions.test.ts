import { describe, expect, it } from "vitest";
import { leadRequestFromResult } from "./capture-lead";
import { bookingIntentFromResult } from "./prepare-booking";

describe("Booking Intent conversion", () => {
  it.each([
    undefined,
    { ok: false as const, reason: "invalid" as const },
    { ok: false as const, reason: "slot_unavailable" as const },
  ])(
    "returns no Booking Intent for a missing or failed result: %j",
    (result) => {
      expect(bookingIntentFromResult(result)).toBeNull();
    },
  );

  it("maps a successful result to the participant and proposed trial occurrence", () => {
    expect(
      bookingIntentFromResult({
        ok: true,
        offering: { id: "offering-1", name: "Kids BJJ" },
        slot: {
          slotId: "occurrence-1",
          localDateLabel: "Wednesday, October 7",
          localTimeLabel: "6:00 PM",
          timezone: "America/New_York",
        },
        participantName: "Ana",
        participantAge: 8,
      }),
    ).toEqual({
      trialOfferingId: "offering-1",
      slotId: "occurrence-1",
      participantName: "Ana",
      participantAge: 8,
    });
  });
});

describe("Lead Request conversion", () => {
  it("returns no Lead Request when there is no result", () => {
    expect(leadRequestFromResult(undefined)).toBeNull();
  });

  it("maps the participant, offering and stated need to a request for consent", () => {
    expect(
      leadRequestFromResult({
        ok: true,
        participantName: "Ana",
        participantAge: 8,
        offeringId: "offering-1",
        statedNeed: "Please contact me about weekend classes.",
      }),
    ).toEqual({
      participantName: "Ana",
      participantAge: 8,
      trialOfferingId: "offering-1",
      statedNeed: "Please contact me about weekend classes.",
    });
  });
});
