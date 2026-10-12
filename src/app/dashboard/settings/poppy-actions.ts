"use server";

import { revalidatePath } from "next/cache";
import { requireOwnedSchool } from "@/lib/auth/current-school";
import { poppyDomainSchema } from "@/lib/poppy/domain";
import { checkSchoolDomain } from "@/lib/poppy/domain-check";
import { domainCheckMessage } from "@/lib/poppy/domain-check-messages";
import { connectSchoolDomain, removeSchoolDomain } from "@/lib/poppy/domains";
import { errorState, type SettingsFormState, successState } from "./form-state";

export async function connectPoppyDomainAction(
  _prev: SettingsFormState,
  data: FormData,
): Promise<SettingsFormState> {
  const { school } = await requireOwnedSchool();
  const parsed = poppyDomainSchema.safeParse(data.get("domain"));
  if (!parsed.success || !parsed.data)
    return errorState("Enter a valid website domain.", {
      domain: "Use a domain like school.example, without https:// or a path.",
    });
  await connectSchoolDomain(school.id, parsed.data);
  revalidatePath("/dashboard/settings");
  return successState(
    "Domain added. Set up the redirect or host the copy, then check now.",
  );
}

export async function checkPoppyDomainAction(
  _prev: SettingsFormState,
  data: FormData,
): Promise<SettingsFormState> {
  const { school } = await requireOwnedSchool();
  const parsed = poppyDomainSchema.safeParse(data.get("domain"));
  if (!parsed.success || !parsed.data)
    return errorState("Enter a valid website domain.");
  const result = await checkSchoolDomain(school.id, parsed.data);
  revalidatePath("/dashboard/settings");
  return result.ok
    ? successState("Domain verified. Poppy is on for your School.")
    : errorState(domainCheckMessage(result.reason), { domain: result.reason });
}

export async function removePoppyDomainAction(
  _prev: SettingsFormState,
  data: FormData,
): Promise<SettingsFormState> {
  const { school } = await requireOwnedSchool();
  const parsed = poppyDomainSchema.safeParse(data.get("domain"));
  if (!parsed.success || !parsed.data)
    return errorState("Enter a valid website domain.");
  await removeSchoolDomain(school.id, parsed.data);
  revalidatePath("/dashboard/settings");
  return successState(
    "Domain removed. Personal Agents will no longer discover your School through it.",
  );
}
