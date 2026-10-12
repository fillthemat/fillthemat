export const SECTION_IDS = [
  "profile",
  "offerings",
  "schedule",
  "pricing",
  "faqs",
  "agent",
  "branding",
  "whatsapp",
] as const;

export type SectionId = (typeof SECTION_IDS)[number];

export type SectionMeta = {
  id: SectionId;
  /** Short label used in the settings navigation. */
  label: string;
  /** Heading for the section itself. */
  title: string;
};

export const SECTIONS: readonly SectionMeta[] = [
  {
    id: "profile",
    label: "School",
    title: "School details",
  },
  {
    id: "offerings",
    label: "Trial classes",
    title: "Trial classes",
  },
  {
    id: "schedule",
    label: "Schedule",
    title: "Weekly schedule",
  },
  {
    id: "pricing",
    label: "Pricing",
    title: "Pricing",
  },
  {
    id: "faqs",
    label: "FAQs",
    title: "Frequently asked questions",
  },
  {
    id: "agent",
    label: "Agent",
    title: "Your agent",
  },
  {
    id: "branding",
    label: "Branding",
    title: "Branding",
  },
  { id: "whatsapp", label: "WhatsApp", title: "WhatsApp" },
] as const;

export const DEFAULT_SECTION: SectionId = "profile";

export function isSectionId(value: unknown): value is SectionId {
  return (
    typeof value === "string" &&
    (SECTION_IDS as readonly string[]).includes(value)
  );
}

/** Unknown or missing sections fall back to the first category. */
export function resolveSection(value: unknown): SectionId {
  return isSectionId(value) ? value : DEFAULT_SECTION;
}

export function sectionMeta(id: SectionId): SectionMeta {
  const found = SECTIONS.find((section) => section.id === id);
  if (!found) throw new Error(`Unknown settings section: ${id}`);
  return found;
}

/**
 * Settings categories are deep-linkable through the `section` query parameter,
 * e.g. `/dashboard/settings?section=schedule`.
 */
export function sectionHref(id: SectionId): string {
  return id === DEFAULT_SECTION
    ? "/dashboard/settings"
    : `/dashboard/settings?section=${id}`;
}
