import type { AssistantContext } from "../context";
import { captureLead } from "./capture-lead";
import { listTrialOfferings } from "./list-trial-offerings";
import { listTrialSlots } from "./list-trial-slots";
import { prepareBooking } from "./prepare-booking";

/** The assistant's model-facing tool names, in one place. */
export function assistantTools(ctx: AssistantContext) {
  return {
    list_trial_offerings: listTrialOfferings(ctx),
    list_trial_slots: listTrialSlots(ctx),
    prepare_booking: prepareBooking(ctx),
    capture_lead: captureLead(ctx),
  };
}
