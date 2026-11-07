/**
 * Fillthemat-owned shared WhatsApp message templates (decision G).
 *
 * v1 keeps this as plumbing/config only: the names/languages/params below are
 * the registry the delivery queue references. Submitting the templates to Meta
 * (so they become sendable outside the 24h customer-service window) is the
 * human-only Phase 6 rollout step — there is no real Meta submission here.
 */

export type WhatsAppUtilityTemplateName =
  "booking_confirmation" | "booking_reminder" | "lead_confirmation";

export const WHATSAPP_TEMPLATE_LANGUAGE = "en_US";

export const WHATSAPP_UTILITY_TEMPLATES: Record<
  WhatsAppUtilityTemplateName,
  { name: string; language: string; paramLabels: string[] }
> = {
  booking_confirmation: {
    name: "booking_confirmation",
    language: WHATSAPP_TEMPLATE_LANGUAGE,
    paramLabels: ["school", "participant", "offering", "when"],
  },
  booking_reminder: {
    name: "booking_reminder",
    language: WHATSAPP_TEMPLATE_LANGUAGE,
    paramLabels: ["school", "participant", "when"],
  },
  lead_confirmation: {
    name: "lead_confirmation",
    language: WHATSAPP_TEMPLATE_LANGUAGE,
    paramLabels: ["school"],
  },
};

export function isWhatsAppUtilityTemplate(
  name: string | null | undefined,
): name is WhatsAppUtilityTemplateName {
  return name != null && name in WHATSAPP_UTILITY_TEMPLATES;
}

/**
 * Local/log rendering of a template body. Used by the no-op transport so the
 * "would-be Graph payload" is readable in local dev, and by unit tests. These
 * strings are NOT Meta-submitted copy — they are what the template params will
 * populate once the real template is approved.
 */
export function renderWhatsAppTemplateBody(
  name: WhatsAppUtilityTemplateName,
  params: unknown[],
): string {
  const values = params.map((value) => (value == null ? "" : String(value)));
  switch (name) {
    case "booking_confirmation":
      return `Trial class confirmed at ${values[0] ?? ""}: ${values[1] ?? ""} — ${values[2] ?? ""} on ${values[3] ?? ""}.`;
    case "booking_reminder":
      return `Reminder: ${values[1] ?? ""}'s trial class at ${values[0] ?? ""} is on ${values[2] ?? ""}.`;
    case "lead_confirmation":
      return `Thanks — ${values[0] ?? ""} will contact you to find a trial time.`;
  }
}

/** Graph template components for a registry template's params. */
export function whatsappTemplateComponents(params: unknown[]) {
  return [
    {
      type: "body",
      parameters: params.map((value) => ({
        type: "text",
        text: value == null ? "" : String(value),
      })),
    },
  ];
}
