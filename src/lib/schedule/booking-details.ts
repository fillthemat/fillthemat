import type { School, TrialOffering } from "@/db/schema";

/** Keep proposal and confirmation descriptions consistent across Channels. */
export function bookingDetails(
  school: Pick<
    School,
    "accessNotes" | "parkingNotes" | "trialGuidance" | "address" | "city"
  >,
  offering: Pick<TrialOffering, "attire" | "expectations">,
) {
  return {
    guidance:
      [
        school.accessNotes,
        school.parkingNotes,
        offering.attire ?? school.trialGuidance,
        offering.expectations,
      ]
        .filter(Boolean)
        .join("\n") || null,
    location: [school.address, school.city].filter(Boolean).join(", "),
  };
}
