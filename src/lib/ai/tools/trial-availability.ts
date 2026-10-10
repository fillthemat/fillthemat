import { listOpenSlots } from "@/lib/schedule/occurrences";
import type { AssistantContext } from "../context";

/** Resolve an active Trial Offering and its open Trial Occurrences this turn. */
export function trialAvailability(
  {
    school,
    catalog: { offerings, windows, occurrences },
    now,
  }: AssistantContext,
  offeringId: string,
) {
  const offering = offerings.find((row) => row.id === offeringId && row.active);
  if (!offering) return null;
  return {
    offering,
    occurrences: listOpenSlots({
      offeringId,
      timezone: school.timezone,
      windows,
      occurrences,
      now,
    }),
  };
}
