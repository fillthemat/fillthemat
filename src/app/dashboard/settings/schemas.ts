import { z } from "zod";
import { isValidTimezone } from "@/lib/timezones";
import { emailSchema, slugSchema } from "@/lib/validation";

/** Limits mirrored in the UI so owners see counters before the server rejects. */
export const LIMITS = {
  schoolName: 80,
  phone: 32,
  website: 2048,
  address: 500,
  city: 80,
  parkingNotes: 2000,
  accessNotes: 2000,
  trialGuidance: 2000,
  pricing: 4000,
  welcomeMessage: 1000,
  agentInstructions: 2000,
  offeringName: 80,
  offeringDescription: 2000,
  offeringExpectations: 2000,
  offeringAttire: 1000,
  offeringWaiverNotes: 1000,
  windowLabel: 80,
  faqQuestion: 200,
  faqAnswer: 2000,
  faqCount: 20,
  logoUrl: 2048,
  capacityMin: 1,
  capacityMax: 50,
  durationMin: 15,
  durationMax: 480,
} as const;

function optional(max: number, tooLong: string) {
  return z
    .string()
    .trim()
    .max(max, tooLong)
    .transform((value) => (value.length === 0 ? null : value));
}

function required(max: number, missing: string, tooLong: string) {
  return z.string().trim().min(1, missing).max(max, tooLong);
}

const ageField = z
  .string()
  .trim()
  .refine(
    (value) => value === "" || /^\d{1,2}$/.test(value),
    "Use a whole age between 0 and 99.",
  )
  .transform((value) => (value === "" ? null : Number(value)));

/** Field name -> first message, ready to render next to an input. */
export function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const flattened = z.flattenError(error);
  const result: Record<string, string> = {};
  for (const [field, messages] of Object.entries(flattened.fieldErrors)) {
    const first = (messages as string[] | undefined)?.[0];
    if (first) result[field] = first;
  }
  if (Object.keys(result).length === 0 && flattened.formErrors[0]) {
    result._form = flattened.formErrors[0];
  }
  return result;
}

export const profileSchema = z.object({
  name: required(
    LIMITS.schoolName,
    "Add the name families should hear.",
    `Keep the name under ${LIMITS.schoolName} characters.`,
  ),
  notificationEmail: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, "That email address is too long.")
    .pipe(z.email("Enter an email address we can notify.")),
  publicContactEmail: z
    .string()
    .trim()
    .pipe(z.union([z.literal(""), emailSchema]))
    .transform((value) => value || null),
  phone: optional(LIMITS.phone, "That phone number is too long."),
  website: optional(LIMITS.website, "That web address is too long.").refine(
    (value) => value == null || /^https?:\/\/\S+\.\S+/.test(value),
    "Enter a full web address, starting with https://",
  ),
  address: optional(LIMITS.address, "That address is too long."),
  city: optional(LIMITS.city, "That city name is too long."),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .refine(
      (value) => value === "" || /^[A-Z]{2}$/.test(value),
      "Use a two-letter country code, such as US.",
    )
    .transform((value) => (value === "" ? "US" : value)),
  parkingNotes: optional(
    LIMITS.parkingNotes,
    "Shorten your parking notes a little.",
  ),
  accessNotes: optional(
    LIMITS.accessNotes,
    "Shorten your entrance notes a little.",
  ),
  trialGuidance: optional(
    LIMITS.trialGuidance,
    "Shorten your arrival guidance a little.",
  ),
});

/** Only parsed while the school is unpublished — both fields lock after that. */
export const publicAddressSchema = z.object({
  slug: slugSchema,
  timezone: z
    .string()
    .trim()
    .refine(isValidTimezone, "Choose a time zone from the list."),
});

export const pricingSchema = z.object({
  pricing: optional(
    LIMITS.pricing,
    `Pricing is limited to ${LIMITS.pricing.toLocaleString("en-US")} characters.`,
  ),
});

export const agentSchema = z.object({
  welcomeMessage: optional(
    LIMITS.welcomeMessage,
    `Keep the welcome message under ${LIMITS.welcomeMessage.toLocaleString("en-US")} characters.`,
  ),
  agentInstructions: optional(
    LIMITS.agentInstructions,
    `Keep your instructions under ${LIMITS.agentInstructions.toLocaleString("en-US")} characters.`,
  ),
});

export const brandingSchema = z.object({
  logoUrl: optional(LIMITS.logoUrl, "That image address is too long.").refine(
    (value) => value == null || value.startsWith("https://"),
    "Logo addresses must start with https://",
  ),
  primaryColor: z
    .string()
    .trim()
    .transform((value) => {
      if (value === "") return null;
      return value.startsWith("#") ? value : `#${value}`;
    })
    .refine(
      (value) => value == null || /^#[0-9A-Fa-f]{6}$/.test(value),
      "Use a 6-digit hex color, such as #1E3A8A.",
    ),
});

export const offeringSchema = z
  .object({
    name: required(
      LIMITS.offeringName,
      "Name this trial class.",
      `Keep the name under ${LIMITS.offeringName} characters.`,
    ),
    description: optional(
      LIMITS.offeringDescription,
      "Shorten the description a little.",
    ),
    minimumAge: ageField,
    maximumAge: ageField,
    attire: optional(LIMITS.offeringAttire, "Shorten the attire note."),
    expectations: optional(
      LIMITS.offeringExpectations,
      "Shorten what to expect a little.",
    ),
    waiverNotes: optional(
      LIMITS.offeringWaiverNotes,
      "Shorten the waiver note.",
    ),
  })
  .refine(
    (value) =>
      value.minimumAge == null ||
      value.maximumAge == null ||
      value.minimumAge <= value.maximumAge,
    {
      message: "The youngest age must be lower than the oldest age.",
      path: ["maximumAge"],
    },
  );

// `<input type="time">` may serialize as HH:MM or HH:MM:SS depending on the
// browser and step; seconds are accepted and ignored.
const timeValue = z
  .string()
  .trim()
  .regex(
    /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,3})?)?$/,
    "Choose a start time.",
  )
  .transform((value) => {
    const [hour, minute] = value.split(":");
    return Number(hour) * 60 + Number(minute);
  });

export const windowSchema = z.object({
  trialOfferingId: z.uuid("Choose which trial class runs at this time."),
  dayOfWeek: z
    .string()
    .trim()
    .refine((value) => /^[0-6]$/.test(value), "Choose a day of the week.")
    .transform(Number),
  startMinute: timeValue,
  durationMinutes: z
    .string()
    .trim()
    .refine(
      (value) =>
        /^\d{1,3}$/.test(value) &&
        Number(value) >= LIMITS.durationMin &&
        Number(value) <= LIMITS.durationMax,
      `Use a length between ${LIMITS.durationMin} and ${LIMITS.durationMax} minutes.`,
    )
    .transform(Number),
  capacity: capacityField(),
  label: optional(LIMITS.windowLabel, "That label is too long."),
});

export function capacityField() {
  return z
    .string()
    .trim()
    .refine(
      (value) =>
        /^\d{1,2}$/.test(value) &&
        Number(value) >= LIMITS.capacityMin &&
        Number(value) <= LIMITS.capacityMax,
      `Use between ${LIMITS.capacityMin} and ${LIMITS.capacityMax} spots.`,
    )
    .transform(Number);
}

export const capacitySchema = z.object({
  id: z.uuid("That class time no longer exists."),
  capacity: capacityField(),
});

export const idSchema = z.object({ id: z.uuid("That item no longer exists.") });

const isoTimestamp = z
  .string()
  .trim()
  .refine(
    (value) => value.length > 0 && !Number.isNaN(Date.parse(value)),
    "Reload the page and try again.",
  );

export const updateOfferingSchema = z.object({
  id: z.uuid("That trial class no longer exists."),
  updatedAt: isoTimestamp,
});

export const toggleOfferingSchema = z.object({
  id: z.uuid("That trial class no longer exists."),
  active: z
    .string()
    .refine(
      (value) => value === "true" || value === "false",
      "Choose whether this trial class should be offered.",
    )
    .transform((value) => value === "true"),
});

export const updateFaqSchema = z.object({
  id: z.uuid("That question no longer exists."),
  updatedAt: isoTimestamp,
});

export const faqSchema = z.object({
  question: required(
    LIMITS.faqQuestion,
    "Add the question a parent would ask.",
    `Keep the question under ${LIMITS.faqQuestion} characters.`,
  ),
  answer: required(
    LIMITS.faqAnswer,
    "Add the answer your agent may share.",
    `Keep the answer under ${LIMITS.faqAnswer.toLocaleString("en-US")} characters.`,
  ),
});

export const OFFERING_EDITOR_FIELDS = [
  "name",
  "description",
  "minimumAge",
  "maximumAge",
  "attire",
  "expectations",
] as const;

export const FAQ_EDITOR_FIELDS = ["question", "answer"] as const;

/** FormData -> plain object of trimmed strings, safe to hand to zod. */
export function formValues(
  formData: FormData,
  fields: readonly string[],
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of fields) {
    const raw = formData.get(field);
    values[field] = typeof raw === "string" ? raw : "";
  }
  return values;
}
