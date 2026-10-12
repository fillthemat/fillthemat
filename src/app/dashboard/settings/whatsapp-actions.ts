"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { requireOwnedSchool } from "@/lib/auth/current-school";
import { createWhatsAppConnection } from "@/lib/whatsapp/connection";
import { errorState, type SettingsFormState, successState } from "./form-state";

export async function enableWhatsAppAction(
  _previous: SettingsFormState,
): Promise<SettingsFormState> {
  const { school } = await requireOwnedSchool();
  try {
    const result = await createWhatsAppConnection().enable(school.id);
    revalidatePath("/dashboard/settings");
    if (result.ok)
      return successState(
        "Your number is reserved. Continue with Meta signup next; WhatsApp is not Live yet.",
      );
    if (result.code === "ineligible")
      return errorState(
        "Complete the missing school details before enabling WhatsApp.",
      );
    if (result.code === "invalid_state")
      return errorState(
        "Setup has already started. Check the current status below.",
      );
    if (result.code === "unconfigured")
      return errorState(
        "Number setup is unavailable. Contact Fillthemat or try again later.",
      );
    return errorState(
      "Setup failed. We could not buy your number. Try setup again.",
    );
  } catch (error) {
    unstable_rethrow(error);
    console.error(
      JSON.stringify({ event: "whatsapp_enable_failed", schoolId: school.id }),
    );
    revalidatePath("/dashboard/settings");
    return errorState(
      "We could not confirm number setup. Contact Fillthemat before trying again so we do not buy a second number.",
    );
  }
}
