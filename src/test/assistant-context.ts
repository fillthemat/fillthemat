import type { AssistantContext } from "@/lib/ai/context";
import { encodeSlotId } from "@/lib/schedule/slot-id";

export const kidsOffering = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Kids BJJ",
  description: "A first class for children.",
  minimumAge: 5,
  maximumAge: 12,
  attire: "Sportswear",
  expectations: "Arrive early",
  active: true,
};

export const adultOffering = {
  ...kidsOffering,
  id: "22222222-2222-4222-8222-222222222222",
  name: "Adult BJJ",
  minimumAge: 16,
  maximumAge: null,
};

export const inactiveOffering = {
  ...kidsOffering,
  id: "33333333-3333-4333-8333-333333333333",
  active: false,
};

export const trialWindow = {
  id: "44444444-4444-4444-8444-444444444444",
  trialOfferingId: kidsOffering.id,
  dayOfWeek: 3,
  startMinute: 18 * 60,
  durationMinutes: 60,
  capacity: 8,
  active: true,
  label: null,
};

export const openSlotId = encodeSlotId(
  trialWindow.id,
  new Date("2026-10-07T22:00:00.000Z"),
);
export const fullSlotId = encodeSlotId(
  trialWindow.id,
  new Date("2026-10-14T22:00:00.000Z"),
);

export function assistantContext(): AssistantContext {
  return {
    school: {
      id: "55555555-5555-4555-8555-555555555555",
      name: "Tiger Dojo",
      timezone: "America/New_York",
      city: "Austin",
      address: null,
      phone: null,
      website: null,
      parkingNotes: null,
      accessNotes: null,
      trialGuidance: null,
      pricing: null,
      welcomeMessage: null,
      agentInstructions: null,
    },
    catalog: {
      offerings: [kidsOffering, adultOffering, inactiveOffering],
      windows: [trialWindow],
      occurrences: [
        {
          trialWindowId: trialWindow.id,
          startAt: new Date("2026-10-07T22:00:00.000Z"),
          capacity: 8,
          bookedCount: 3,
        },
        {
          trialWindowId: trialWindow.id,
          startAt: new Date("2026-10-14T22:00:00.000Z"),
          capacity: 8,
          bookedCount: 8,
        },
      ],
      faqs: [],
    },
    now: new Date("2026-10-05T12:00:00.000Z"),
  };
}

export const toolExecutionOptions = {
  toolCallId: "test",
  messages: [],
  context: {},
};
