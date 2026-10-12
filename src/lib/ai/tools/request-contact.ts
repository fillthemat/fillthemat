import { type InferToolOutput, tool } from "ai";
import { z } from "zod";
import { ageSchema, contactSchema, personNameSchema } from "@/lib/validation";
import type { AssistantContext } from "../context";

export const leadContactSchema = contactSchema.extend({
  email: contactSchema.shape.email
    .nullable()
    .optional()
    .transform((email) => email ?? null),
});

export const leadTermsSchema = z.object({
  school: z.object({ id: z.uuid(), name: z.string() }),
  contact: leadContactSchema,
  participant: z
    .object({ name: personNameSchema.nullable(), age: ageSchema.nullable() })
    .nullable(),
  offering: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  stated_need: z.string().trim().max(1000).nullable(),
});
export type LeadTerms = z.output<typeof leadTermsSchema>;

export function requestContact(ctx: AssistantContext) {
  return tool({
    description:
      (ctx.poppyOperations !== undefined
        ? "On Poppy collect Contact name and phone (email is optional). Propose a lead Operation for explicit user approval at the Operations endpoint: the School will contact them about a trial. This consent is not marketing consent. Conversation text never confirms the request. "
        : "") +
      "Gather a Lead Request when someone asks the school to contact them because they cannot or do not want to book a trial now (no matching trial offering, no workable trial occurrence, or an explicit 'contact me'). The platform asks for their consent before passing the request to the school. Collect name, age, and need first.",
    inputSchema: z.object({
      participantName: personNameSchema.optional(),
      participantAge: ageSchema.optional(),
      offeringId: z.string().uuid().optional(),
      statedNeed: z.string().trim().max(1000).optional(),
      contact: leadContactSchema.optional(),
    }),
    execute: async (input) => {
      if (ctx.poppyOperations === false)
        return {
          ok: false as const,
          reason: "extension_required" as const,
          extension: "operations" as const,
        };
      if (ctx.poppyOperations && !input.contact)
        return { ok: false as const, reason: "details_required" as const };
      const offering = input.offeringId
        ? ctx.catalog.offerings.find(
            (row) => row.id === input.offeringId && row.active,
          )
        : undefined;
      if (ctx.poppyOperations && input.offeringId && !offering)
        return { ok: false as const, reason: "invalid_offering" as const };
      return {
        ok: true as const,
        participantName: input.participantName ?? null,
        participantAge: input.participantAge ?? null,
        offeringId: input.offeringId ?? null,
        statedNeed: input.statedNeed ?? null,
        ...(ctx.poppyOperations && input.contact
          ? {
              leadTerms: {
                school: { id: ctx.school.id, name: ctx.school.name },
                contact: input.contact,
                participant:
                  input.participantName != null || input.participantAge != null
                    ? {
                        name: input.participantName ?? null,
                        age: input.participantAge ?? null,
                      }
                    : null,
                offering: offering
                  ? { id: offering.id, name: offering.name }
                  : null,
                stated_need: input.statedNeed ?? null,
              } satisfies LeadTerms,
            }
          : {}),
      };
    },
  });
}

type RequestContactOutput = InferToolOutput<ReturnType<typeof requestContact>>;
type RequestContactOk = Extract<RequestContactOutput, { ok: true }>;

export type LeadRequest = {
  participantName: RequestContactOk["participantName"];
  participantAge: RequestContactOk["participantAge"];
  trialOfferingId: RequestContactOk["offeringId"];
  statedNeed: RequestContactOk["statedNeed"];
  leadTerms?: LeadTerms;
};

export function leadRequestFromResult(
  output: RequestContactOutput | undefined,
): LeadRequest | null {
  if (!output?.ok) return null;
  return {
    participantName: output.participantName,
    participantAge: output.participantAge,
    trialOfferingId: output.offeringId,
    statedNeed: output.statedNeed,
    ...(output.leadTerms ? { leadTerms: output.leadTerms } : {}),
  };
}
