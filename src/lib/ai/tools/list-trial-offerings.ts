import { tool } from "ai";
import { z } from "zod";
import { isAgeEligible } from "@/lib/schedule/occurrences";
import type { AssistantContext } from "../context";

export function listTrialOfferings({
  catalog: { offerings },
}: AssistantContext) {
  return tool({
    description:
      "List trial offerings. Optionally filter by participant age in years.",
    inputSchema: z.object({
      participantAge: z.number().int().min(0).max(99).optional(),
    }),
    execute: async ({ participantAge }) => {
      const filtered = offerings.filter((offering) => {
        if (!offering.active) return false;
        if (participantAge == null) return true;
        return isAgeEligible(participantAge, offering);
      });
      return {
        offerings: filtered.map((offering) => ({
          id: offering.id,
          name: offering.name,
          description: offering.description,
          minimumAge: offering.minimumAge,
          maximumAge: offering.maximumAge,
          attire: offering.attire,
          expectations: offering.expectations,
        })),
        noMatch: filtered.length === 0,
      };
    },
  });
}
