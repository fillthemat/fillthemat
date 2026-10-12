"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { requireOwnedSchool } from "@/lib/auth/current-school";
import {
  createWhatsAppConnection,
  type SignupCompletion,
  signupCompletionSchema,
} from "@/lib/whatsapp/connection";
import { errorState, type SettingsFormState, successState } from "./form-state";

export async function enableWhatsAppAction(
  _previous: SettingsFormState,
): Promise<SettingsFormState> {
  const { school } = await requireOwnedSchool();
  try {
    const connection = createWhatsAppConnection();
    const current = await connection.read(school.id);
    const result =
      current.state === "cooling"
        ? await connection.switchOn(school.id)
        : await connection.enable(school.id);
    revalidatePath("/dashboard/settings");
    revalidatePath(`/s/${school.slug}`);
    if (result.ok && current.state === "cooling")
      return successState("WhatsApp is switched back on with the same number.");
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

export async function readWhatsAppSignupAction() {
  const { school } = await requireOwnedSchool();
  return createWhatsAppConnection().read(school.id);
}

export async function switchOffWhatsAppAction(): Promise<SettingsFormState> {
  const { school } = await requireOwnedSchool();
  const result = await createWhatsAppConnection().switchOff(school.id);
  revalidatePath("/dashboard/settings");
  revalidatePath(`/s/${school.slug}`);
  return result.ok
    ? successState(
        "WhatsApp is off. Switch back on within 30 days to keep your number.",
      )
    : errorState(
        "We could not switch WhatsApp off. Reload settings and check its status.",
      );
}

export async function checkWhatsAppReadinessAction(): Promise<SettingsFormState> {
  const { school } = await requireOwnedSchool();
  try {
    const result = await createWhatsAppConnection().checkReadiness(school.id);
    revalidatePath("/dashboard/settings");
    revalidatePath(`/s/${school.slug}`);
    if (!result.ok)
      return errorState(
        "We could not confirm readiness with Meta. WhatsApp is not Live yet; try checking again.",
      );
    return successState(
      result.connection.state === "live"
        ? "WhatsApp is Live. Share your number and link with prospects."
        : result.connection.state.startsWith("broken-")
          ? "WhatsApp is still broken. Meta has not confirmed that the connection is healthy; complete the fix shown below, then check again."
          : "WhatsApp is switched on but not Live. Meta must confirm a registered number and a payment card on file. After adding your card, check again.",
    );
  } catch (error) {
    unstable_rethrow(error);
    console.error(
      JSON.stringify({
        event: "whatsapp_readiness_failed",
        schoolId: school.id,
      }),
    );
    throw new Error("whatsapp_readiness_failed");
  }
}

export async function startWhatsAppSignupAction() {
  const { school } = await requireOwnedSchool();
  const result = await createWhatsAppConnection().startSignup(school.id);
  revalidatePath("/dashboard/settings");
  return result;
}

export async function endWhatsAppSignupAction(
  attemptId: string,
  outcome: "cancelled" | "failed",
) {
  const { school } = await requireOwnedSchool();
  if (
    !z.uuid().safeParse(attemptId).success ||
    !z.enum(["cancelled", "failed"]).safeParse(outcome).success
  )
    throw new Error("invalid_signup_input");
  const connection = createWhatsAppConnection();
  const result =
    outcome === "cancelled"
      ? await connection.cancelSignup(school.id, attemptId)
      : await connection.failSignup(school.id, attemptId);
  revalidatePath("/dashboard/settings");
  return result;
}

export async function completeWhatsAppSignupAction(input: SignupCompletion) {
  const { school } = await requireOwnedSchool();
  const validated = signupCompletionSchema.safeParse(input);
  if (!validated.success) throw new Error("invalid_signup_input");
  try {
    const result = await createWhatsAppConnection().completeSignup(
      school.id,
      validated.data,
    );
    revalidatePath("/dashboard/settings");
    return result;
  } catch (error) {
    unstable_rethrow(error);
    console.error(
      JSON.stringify({ event: "whatsapp_signup_failed", schoolId: school.id }),
    );
    revalidatePath("/dashboard/settings");
    // Do not serialize provider/crypto errors, exchange codes or customer tokens.
    throw new Error("whatsapp_signup_failed");
  }
}
