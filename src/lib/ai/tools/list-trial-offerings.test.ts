import { describe, expect, it } from "vitest";
import {
  assistantContext,
  kidsOffering,
  toolExecutionOptions,
} from "@/test/assistant-context";
import { listTrialOfferings } from "./list-trial-offerings";

describe("list trial offerings", () => {
  it("lists only active offerings eligible for the participant's age", async () => {
    const result = await listTrialOfferings(assistantContext()).execute?.(
      { participantAge: 8 },
      toolExecutionOptions,
    );

    expect(result).toEqual({
      offerings: [
        {
          id: kidsOffering.id,
          name: "Kids BJJ",
          description: "A first class for children.",
          minimumAge: 5,
          maximumAge: 12,
          attire: "Sportswear",
          expectations: "Arrive early",
        },
      ],
      noMatch: false,
    });
  });
});
