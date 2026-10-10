import type { UIMessage } from "ai";
import { kidsOffering, openSlotId } from "./assistant-context";

/** Persisted pre-rename web-chat tool parts, not rewritten to current names. */
export function legacyAssistantHistory(): UIMessage[] {
  return [
    {
      id: "legacy-question",
      role: "user",
      parts: [
        { type: "text", text: "What trials are available for Sam, age 5?" },
      ],
    },
    {
      id: "legacy-occurrences",
      role: "assistant",
      parts: [
        {
          type: "tool-list_trial_slots",
          toolCallId: "legacy-occurrences",
          state: "output-available",
          input: { offeringId: kidsOffering.id },
          output: {
            noMatch: false,
            slots: [
              {
                slotId: openSlotId,
                localDateLabel: "Wednesday, October 7",
                localTimeLabel: "6:00 PM",
                remaining: 5,
                timezone: "America/New_York",
              },
            ],
          },
        },
      ],
    },
    {
      id: "legacy-contact-question",
      role: "user",
      parts: [
        { type: "text", text: "Please ask the school to contact me instead." },
      ],
    },
    {
      id: "legacy-contact",
      role: "assistant",
      parts: [
        {
          type: "tool-capture_lead",
          toolCallId: "legacy-contact",
          state: "output-available",
          input: {
            participantName: "Sam",
            participantAge: 5,
            statedNeed: "Trial questions",
          },
          output: {
            ok: true,
            participantName: "Sam",
            participantAge: 5,
            offeringId: null,
            statedNeed: "Trial questions",
          },
        },
      ],
    },
    {
      id: "legacy-recap",
      role: "user",
      parts: [
        {
          type: "text",
          text: "Recap the time you showed me and the contact request. Do not book or submit anything.",
        },
      ],
    },
  ];
}
