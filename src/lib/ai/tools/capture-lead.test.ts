import { describe, expect, it } from "vitest";
import {
  assistantContext,
  kidsOffering,
  toolExecutionOptions,
} from "@/test/assistant-context";
import { captureLead } from "./capture-lead";

describe("gather a Lead Request", () => {
  it("returns the participant, offering and stated need for consent without creating a lead", async () => {
    const result = await captureLead(assistantContext()).execute?.(
      {
        participantName: "Ana",
        participantAge: 8,
        offeringId: kidsOffering.id,
        statedNeed: "Please contact me about weekend classes.",
      },
      toolExecutionOptions,
    );

    expect(result).toEqual({
      ok: true,
      participantName: "Ana",
      participantAge: 8,
      offeringId: kidsOffering.id,
      statedNeed: "Please contact me about weekend classes.",
    });
  });
});
