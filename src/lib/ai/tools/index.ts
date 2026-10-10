import type { AssistantContext } from "../context";
import { listTrialOccurrences } from "./list-trial-occurrences";
import { listTrialOfferings } from "./list-trial-offerings";
import { prepareBooking } from "./prepare-booking";
import { requestContact } from "./request-contact";

/** The assistant's model-facing tool names, in one place. */
export function assistantTools(ctx: AssistantContext) {
  return {
    list_trial_offerings: listTrialOfferings(ctx),
    list_trial_occurrences: listTrialOccurrences(ctx),
    prepare_booking: prepareBooking(ctx),
    request_contact: requestContact(ctx),
  };
}
