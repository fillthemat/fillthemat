import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/db/types";
import { errorState, type SettingsFormState, successState } from "./form-state";
import { nullToEmpty } from "./format";
import { LIMITS } from "./limits";

type Client = SupabaseClient<Database>;
export const MISSING_OFFERING = "That trial class no longer exists. Refresh the page.";
export const MISSING_FAQ = "That question no longer exists. Refresh the page.";
export const STALE_EDIT =
  "This was updated elsewhere. Your edits are still here — reload the page to see the latest, then save again.";

export type OfferingEditorInput = {
  name: string;
  description: string | null;
  minimumAge: number | null;
  maximumAge: number | null;
  attire: string | null;
  expectations: string | null;
  waiverNotes?: string | null;
};

function offeringValues(row: Tables<"trial_offerings">): Record<string, string> {
  return {
    id: row.id,
    name: row.name,
    description: nullToEmpty(row.description),
    minimumAge: nullToEmpty(row.minimum_age),
    maximumAge: nullToEmpty(row.maximum_age),
    attire: nullToEmpty(row.attire),
    expectations: nullToEmpty(row.expectations),
    updatedAt: row.updated_at,
  };
}

function offeringInput(input: OfferingEditorInput) {
  return {
    name: input.name,
    description: input.description,
    minimum_age: input.minimumAge,
    maximum_age: input.maximumAge,
    attire: input.attire,
    expectations: input.expectations,
  };
}

function faqValues(row: Tables<"faqs">) {
  return { id: row.id, question: row.question, answer: row.answer, updatedAt: row.updated_at };
}

export async function insertOffering(
  client: Client,
  schoolId: string,
  input: OfferingEditorInput,
): Promise<SettingsFormState> {
  const { data, error } = await client
    .from("trial_offerings")
    .insert({
      ...offeringInput(input),
      school_id: schoolId,
      waiver_notes: input.waiverNotes ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return successState(`“${data.name}” added and open for bookings.`, offeringValues(data));
}

export async function updateOffering(
  client: Client,
  schoolId: string,
  id: string,
  expectedUpdatedAt: string,
  input: OfferingEditorInput,
): Promise<SettingsFormState> {
  const { data, error } = await client
    .from("trial_offerings")
    .update({
      ...offeringInput(input),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("school_id", schoolId)
    .eq("updated_at", expectedUpdatedAt)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (data)
    return successState(
      `“${data.name}” saved. New bookings use these settings.`,
      offeringValues(data),
    );
  const { data: existing, error: readError } = await client
    .from("trial_offerings")
    .select("id")
    .eq("id", id)
    .eq("school_id", schoolId)
    .maybeSingle();
  if (readError) throw readError;
  return errorState(existing ? STALE_EDIT : MISSING_OFFERING);
}

export async function setOfferingActive(
  client: Client,
  schoolId: string,
  id: string,
  desiredActive: boolean,
): Promise<SettingsFormState> {
  const { data, error } = await client
    .from("trial_offerings")
    .update({ active: desiredActive, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("school_id", schoolId)
    .eq("active", !desiredActive)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (data)
    return successState(
      data.active
        ? `“${data.name}” is open for bookings again.`
        : `“${data.name}” is no longer offered to families.`,
    );
  const { data: existing, error: readError } = await client
    .from("trial_offerings")
    .select("name, active")
    .eq("id", id)
    .eq("school_id", schoolId)
    .maybeSingle();
  if (readError) throw readError;
  if (!existing) return errorState(MISSING_OFFERING);
  return successState(
    existing.active
      ? `“${existing.name}” is already offered to families.`
      : `“${existing.name}” is already not offered.`,
    { unchanged: "true" },
  );
}

export async function insertFaq(
  client: Client,
  schoolId: string,
  input: { question: string; answer: string },
): Promise<SettingsFormState> {
  const { data, error } = await client
    .rpc("create_settings_faq", {
      p_school_id: schoolId,
      p_question: input.question,
      p_answer: input.answer,
    })
    .single();
  if (error?.message === "faq_limit_reached")
    return errorState(
      `You already have ${LIMITS.faqCount} questions. Delete one before adding another.`,
    );
  if (error) throw error;
  return successState("Question added. Your agent can use this answer now.", faqValues(data));
}

export async function updateFaq(
  client: Client,
  schoolId: string,
  id: string,
  expectedUpdatedAt: string,
  input: { question: string; answer: string },
): Promise<SettingsFormState> {
  const { data, error } = await client
    .from("faqs")
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("school_id", schoolId)
    .eq("updated_at", expectedUpdatedAt)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (data)
    return successState("Question saved. Your agent uses this answer now.", faqValues(data));
  const { data: existing, error: readError } = await client
    .from("faqs")
    .select("id")
    .eq("id", id)
    .eq("school_id", schoolId)
    .maybeSingle();
  if (readError) throw readError;
  return errorState(existing ? STALE_EDIT : MISSING_FAQ);
}

export async function deleteFaqRecord(
  client: Client,
  schoolId: string,
  id: string,
): Promise<SettingsFormState> {
  const { data, error } = await client
    .from("faqs")
    .delete()
    .eq("id", id)
    .eq("school_id", schoolId)
    .select("id");
  if (error) throw error;
  if (!data.length) return errorState(MISSING_FAQ);
  return successState("Question deleted. Your agent will not use it again.");
}
