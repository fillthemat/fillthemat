import { describe, expect, it } from "vitest";
import {
  assistantContext,
  kidsOffering,
  openSlotId,
  toolExecutionOptions,
} from "@/test/assistant-context";
import { prepareBooking } from "./prepare-booking";

describe("prepare a Booking Intent", () => {
  it("returns the offering, open occurrence and participant for confirmation without creating a booking", async () => {
    const result = await prepareBooking(assistantContext()).execute?.(
      {
        offeringId: kidsOffering.id,
        slotId: openSlotId,
        participantName: "Ana",
        participantAge: 8,
      },
      toolExecutionOptions,
    );

    expect(result).toEqual({
      ok: true,
      offering: { id: kidsOffering.id, name: "Kids BJJ" },
      slot: {
        slotId: openSlotId,
        localDateLabel: "Wednesday, October 7",
        localTimeLabel: "6:00 PM",
        timezone: "America/New_York",
      },
      participantName: "Ana",
      participantAge: 8,
    });
  });
});
