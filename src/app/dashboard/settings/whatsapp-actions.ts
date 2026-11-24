"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSchool } from "@/lib/auth/current-school";
import { whatsappSignupConfigured } from "@/lib/whatsapp/config";
import { completeSignup, setWhatsAppSignupState, signupInput } from "@/lib/whatsapp/signup";

async function eligibleSchool() {
  const { school } = await requireSchool();
  if (!school.approved_at || !school.published_at) throw new Error("school_not_eligible");
  if (!whatsappSignupConfigured()) throw new Error("signup_unconfigured");
  return school;
}

export async function completeWhatsAppSignup(input: unknown) {
  const school = await eligibleSchool();
  const parsed = signupInput.safeParse(input);
  if (!parsed.success) return { ok: false as const, code: "invalid_signup" };
  const result = await completeSignup(school.id, parsed.data);
  revalidatePath("/dashboard/settings");
  return result;
}

export async function updateWhatsAppPopup(input: unknown) {
  const school = await eligibleSchool();
  const state = z.enum(["popup", "cancelled", "popup-failed"]).parse(input);
  await setWhatsAppSignupState(
    school.id,
    state,
    state === "popup-failed" ? "embedded_signup_error" : null,
  );
  revalidatePath("/dashboard/settings");
}
