import { describe, expect, it } from "vitest";
import { isAgeEligible, listOpenSlots, type SlotWindow } from "./occurrences";
import { parseSlotId } from "./slot-id";

const WINDOW_ID = "11111111-1111-4111-8111-111111111111";
const OFFERING_ID = "22222222-2222-4222-8222-222222222222";

function window(overrides: Partial<SlotWindow> = {}): SlotWindow {
  return {
    id: WINDOW_ID,
    trialOfferingId: OFFERING_ID,
    dayOfWeek: 1,
    startMinute: 18 * 60,
    durationMinutes: 60,
    capacity: 4,
    active: true,
    label: "Beginner",
    ...overrides,
  };
}

describe("listOpenSlots", () => {
  it("returns exact UTC instants in America/New_York", () => {
    const now = new Date("2026-03-09T15:00:00.000Z");
    const slots = listOpenSlots({
      offeringId: OFFERING_ID,
      timezone: "America/New_York",
      windows: [window({ dayOfWeek: 1, startMinute: 18 * 60 })],
      occurrences: [],
      now,
    });

    expect(slots.length).toBeGreaterThan(0);
    const first = slots[0];
    expect(first.startAt.toISOString()).toBe("2026-03-09T22:00:00.000Z");
    expect(first.endAt.toISOString()).toBe("2026-03-09T23:00:00.000Z");
    expect(first.localTimeLabel).toMatch(/6:00 PM/i);
    expect(parseSlotId(first.slotId)).toEqual({
      windowId: WINDOW_ID,
      startAt: first.startAt,
    });
  });

  it("returns exact UTC instants in America/Los_Angeles", () => {
    const now = new Date("2026-03-09T15:00:00.000Z");
    const slots = listOpenSlots({
      offeringId: OFFERING_ID,
      timezone: "America/Los_Angeles",
      windows: [window({ dayOfWeek: 1, startMinute: 18 * 60 })],
      occurrences: [],
      now,
    });
    expect(slots[0]?.startAt.toISOString()).toBe("2026-03-10T01:00:00.000Z");
  });

  it("skips nonexistent DST spring-forward local times", () => {
    const now = new Date("2026-03-01T15:00:00.000Z");
    const slots = listOpenSlots({
      offeringId: OFFERING_ID,
      timezone: "America/New_York",
      windows: [window({ dayOfWeek: 0, startMinute: 2 * 60 + 30 })],
      occurrences: [],
      now,
    });
    expect(slots.some((slot) => slot.startAt.toISOString().startsWith("2026-03-08"))).toBe(false);
  });

  it("uses the earlier offset for a repeated fall-back local time", () => {
    const now = new Date("2026-10-20T15:00:00.000Z");
    const slots = listOpenSlots({
      offeringId: OFFERING_ID,
      timezone: "America/New_York",
      windows: [window({ dayOfWeek: 0, startMinute: 90 })],
      occurrences: [],
      now,
    });
    const fold = slots.find((slot) => slot.startAt.toISOString().startsWith("2026-11-01"));
    expect(fold?.startAt.toISOString()).toBe("2026-11-01T05:30:00.000Z");
  });

  it("omits slots inside the lead-time bound and beyond the horizon", () => {
    const now = new Date("2026-03-09T21:00:00.000Z");
    const slots = listOpenSlots({
      offeringId: OFFERING_ID,
      timezone: "America/New_York",
      windows: [window({ dayOfWeek: 1, startMinute: 18 * 60 })],
      occurrences: [],
      now,
    });
    expect(slots[0]?.startAt.toISOString()).not.toBe("2026-03-09T22:00:00.000Z");
    expect(
      slots.every((slot) => slot.startAt.getTime() <= now.getTime() + 14 * 24 * 60 * 60 * 1000),
    ).toBe(true);
  });

  it("uses occurrence capacity snapshots and omits full slots", () => {
    const now = new Date("2026-03-09T15:00:00.000Z");
    const startAt = new Date("2026-03-09T22:00:00.000Z");
    const slots = listOpenSlots({
      offeringId: OFFERING_ID,
      timezone: "America/New_York",
      windows: [window({ capacity: 8 })],
      occurrences: [
        {
          trialWindowId: WINDOW_ID,
          startAt,
          capacity: 2,
          bookedCount: 2,
        },
      ],
      now,
    });
    expect(slots.some((slot) => slot.startAt.getTime() === startAt.getTime())).toBe(false);
  });
});

describe("isAgeEligible", () => {
  it("respects inclusive age ranges", () => {
    expect(isAgeEligible(5, { minimumAge: 6, maximumAge: 12 })).toBe(false);
    expect(isAgeEligible(6, { minimumAge: 6, maximumAge: 12 })).toBe(true);
    expect(isAgeEligible(12, { minimumAge: 6, maximumAge: 12 })).toBe(true);
    expect(isAgeEligible(13, { minimumAge: 6, maximumAge: 12 })).toBe(false);
    expect(isAgeEligible(40, { minimumAge: null, maximumAge: null })).toBe(true);
  });
});
