import { describe, expect, it } from "vitest";
import {
  assistantContext,
  fullSlotId,
  kidsOffering,
  openSlotId,
  toolExecutionOptions,
} from "@/test/assistant-context";
import { listTrialSlots } from "./list-trial-slots";

describe("list trial occurrences", () => {
  it("lists open occurrences with local times and remaining capacity, excluding full occurrences", async () => {
    const result = await listTrialSlots(assistantContext()).execute?.(
      { offeringId: kidsOffering.id },
      toolExecutionOptions,
    );

    expect(result).toMatchObject({
      noMatch: false,
      slots: expect.arrayContaining([
        {
          slotId: openSlotId,
          localDateLabel: "Wednesday, October 7",
          localTimeLabel: "6:00 PM",
          remaining: 5,
          timezone: "America/New_York",
        },
      ]),
    });
    expect(result).not.toMatchObject({
      slots: expect.arrayContaining([
        expect.objectContaining({ slotId: fullSlotId }),
      ]),
    });
  });
});
