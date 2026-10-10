import { describe, expect, it } from "vitest";
import { maskContactFields } from "../../src/lib/tracing/span-processor";
import { scoreIntents, scoreToolCalls } from "./scoring";

describe("intent scoring", () => {
  it("requires no intent when none was expected and checks all booking fields rather than presence", () => {
    const booking = {
      trialOfferingId: "offering",
      slotId: "occurrence",
      participantName: "Sam",
      participantAge: 5,
    };
    expect(
      scoreIntents(
        { bookingIntent: null, leadRequest: null },
        { bookingIntent: booking, leadRequest: null },
      ).map((s) => s.value),
    ).toEqual([0, 1]);
    expect(
      scoreIntents(
        { bookingIntent: booking, leadRequest: null },
        {
          bookingIntent: { ...booking, participantAge: 15 },
          leadRequest: null,
        },
      ).map((s) => s.value),
    ).toEqual([0, 1]);
    expect(
      scoreIntents(
        { bookingIntent: booking, leadRequest: null },
        { bookingIntent: { ...booking }, leadRequest: null },
      ).map((s) => s.value),
    ).toEqual([1, 1]);
  });
  it("checks Lead Request fields exactly but permits a paraphrased, non-empty stated need", () => {
    const lead = {
      participantName: "Sam",
      participantAge: 5,
      trialOfferingId: null,
      statedNeed: "non-empty" as const,
    };
    expect(
      scoreIntents(
        { bookingIntent: null, leadRequest: lead },
        {
          bookingIntent: null,
          leadRequest: { ...lead, statedNeed: "Please call about a trial" },
        },
      ).map((s) => s.value),
    ).toEqual([1, 1]);
    expect(
      scoreIntents(
        { bookingIntent: null, leadRequest: lead },
        { bookingIntent: null, leadRequest: { ...lead, statedNeed: " " } },
      ).map((s) => s.value),
    ).toEqual([1, 0]);
  });
});

describe("tool-call scoring", () => {
  it("fails both a missing required call and a forbidden call, with independent scores", () => {
    expect(
      scoreToolCalls(
        { called: ["list_trial_offerings"], notCalled: ["prepare_booking"] },
        ["prepare_booking"],
      ),
    ).toEqual([
      { name: "tool:list_trial_offerings:called", value: 0 },
      { name: "tool:prepare_booking:not-called", value: 0 },
    ]);
  });
  it("accepts the glossary tool renames without hiding unrelated calls", () => {
    expect(
      scoreToolCalls(
        {
          called: ["list_trial_occurrences", "request_contact"],
          notCalled: ["prepare_booking"],
        },
        ["list_trial_slots", "capture_lead"],
      ).map((s) => s.value),
    ).toEqual([1, 1, 1]);
  });
});

describe("eval exports", () => {
  it("masks contact fields inside JSON-encoded trace inputs without masking ages or dates", () => {
    expect(
      maskContactFields({
        input: JSON.stringify({
          text: "Email a@example.com, call\n4165551234. Age 5, 2026-10-12 at 18:00.",
        }),
      }),
    ).toEqual({
      input: JSON.stringify({
        text: "Email [email], call\n[phone]. Age 5, 2026-10-12 at 18:00.",
      }),
    });
  });
});
