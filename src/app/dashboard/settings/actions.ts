"use server";

import { and, eq, gt, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { getDb } from "@/db";
import { schools, trialOccurrences, trialOfferings, trialWindows } from "@/db/schema";
import { requireSchool } from "@/lib/auth/current-school";
import { publicSchoolPath } from "@/lib/site-url";
import {
  errorState,
  GENERIC_SERVER_ERROR,
  type SettingsFormState,
  successState,
} from "./form-state";
import { formatCount } from "./format";
import {
  deleteFaqRecord,
  insertFaq,
  insertOffering,
  setOfferingActive,
  updateFaq,
  updateOffering,
} from "./mutations";
import {
  agentSchema,
  brandingSchema,
  capacitySchema,
  FAQ_EDITOR_FIELDS,
  faqSchema,
  fieldErrorsFrom,
  formValues,
  idSchema,
  OFFERING_EDITOR_FIELDS,
  offeringSchema,
  pricingSchema,
  profileSchema,
  publicAddressSchema,
  toggleOfferingSchema,
  updateFaqSchema,
  updateOfferingSchema,
  windowSchema,
} from "./schemas";

function revalidateOwnerViews(slug: string) {
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard");
  revalidatePath(publicSchoolPath(slug));
}

function nullToEmpty(value: string | null | undefined): string {
  return value ?? "";
}

/**
 * Every action returns a `SettingsFormState`; unexpected failures become a
 * server error the owner can act on instead of a silent no-op.
 *
 * Next.js control flow (the `redirect()` inside `requireOwnedSchool()` for an
 * expired session, `notFound()`, …) is implemented by throwing, so it has to be
 * re-thrown before anything is mapped to form state.
 */
async function run(work: () => Promise<SettingsFormState>): Promise<SettingsFormState> {
  try {
    return await work();
  } catch (error) {
    unstable_rethrow(error);
    console.error("[settings] action failed", error);
    return errorState(GENERIC_SERVER_ERROR);
  }
}

export async function updateProfileAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  return run(async () => {
    const { school } = await requireSchool();
    const published = school.publishedAt != null;

    const parsed = profileSchema.safeParse(
      formValues(formData, [
        "name",
        "notificationEmail",
        "phone",
        "website",
        "address",
        "city",
        "country",
        "parkingNotes",
        "accessNotes",
        "trialGuidance",
      ]),
    );

    let slug = school.slug;
    let timezone = school.timezone;
    let publicErrors: Record<string, string> = {};
    if (!published) {
      const address = publicAddressSchema.safeParse(formValues(formData, ["slug", "timezone"]));
      if (address.success) {
        slug = address.data.slug;
        timezone = address.data.timezone;
      } else {
        publicErrors = fieldErrorsFrom(address.error);
      }
    }

    if (!parsed.success || Object.keys(publicErrors).length > 0) {
      return errorState("Check the highlighted fields and save again.", {
        ...(parsed.success ? {} : fieldErrorsFrom(parsed.error)),
        ...publicErrors,
      });
    }

    const values = parsed.data;
    const db = getDb();
    await db
      .update(schools)
      .set({
        name: values.name,
        slug,
        timezone,
        notificationEmail: values.notificationEmail,
        phone: values.phone,
        website: values.website,
        address: values.address,
        city: values.city,
        country: values.country,
        parkingNotes: values.parkingNotes,
        accessNotes: values.accessNotes,
        trialGuidance: values.trialGuidance,
        updatedAt: new Date(),
      })
      .where(eq(schools.id, school.id));
    revalidateOwnerViews(school.slug);

    return successState("School details saved. Your agent uses them now.", {
      name: values.name,
      slug,
      timezone,
      notificationEmail: values.notificationEmail,
      phone: nullToEmpty(values.phone),
      website: nullToEmpty(values.website),
      address: nullToEmpty(values.address),
      city: nullToEmpty(values.city),
      country: values.country,
      parkingNotes: nullToEmpty(values.parkingNotes),
      accessNotes: nullToEmpty(values.accessNotes),
      trialGuidance: nullToEmpty(values.trialGuidance),
    });
  });
}

export async function updatePricingAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  return run(async () => {
    const { school } = await requireSchool();
    const parsed = pricingSchema.safeParse(formValues(formData, ["pricing"]));
    if (!parsed.success) {
      return errorState(
        "Check the highlighted field and save again.",
        fieldErrorsFrom(parsed.error),
      );
    }
    const db = getDb();
    await db
      .update(schools)
      .set({ pricing: parsed.data.pricing, updatedAt: new Date() })
      .where(eq(schools.id, school.id));
    revalidateOwnerViews(school.slug);
    return successState("Pricing saved. Your agent may share it now.", {
      pricing: nullToEmpty(parsed.data.pricing),
    });
  });
}

export async function updateAgentAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  return run(async () => {
    const { school } = await requireSchool();
    const parsed = agentSchema.safeParse(
      formValues(formData, ["welcomeMessage", "agentInstructions"]),
    );
    if (!parsed.success) {
      return errorState(
        "Check the highlighted fields and save again.",
        fieldErrorsFrom(parsed.error),
      );
    }
    const db = getDb();
    await db
      .update(schools)
      .set({
        welcomeMessage: parsed.data.welcomeMessage,
        agentInstructions: parsed.data.agentInstructions,
        updatedAt: new Date(),
      })
      .where(eq(schools.id, school.id));
    revalidateOwnerViews(school.slug);
    return successState("Agent settings saved and live on your page.", {
      welcomeMessage: nullToEmpty(parsed.data.welcomeMessage),
      agentInstructions: nullToEmpty(parsed.data.agentInstructions),
    });
  });
}

export async function updateBrandingAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  return run(async () => {
    const { school } = await requireSchool();
    const parsed = brandingSchema.safeParse(formValues(formData, ["logoUrl", "primaryColor"]));
    if (!parsed.success) {
      return errorState(
        "Check the highlighted fields and save again.",
        fieldErrorsFrom(parsed.error),
      );
    }
    const db = getDb();
    await db
      .update(schools)
      .set({
        logoUrl: parsed.data.logoUrl,
        primaryColor: parsed.data.primaryColor,
        updatedAt: new Date(),
      })
      .where(eq(schools.id, school.id));
    revalidateOwnerViews(school.slug);
    return successState("Branding saved and live on your public page.", {
      logoUrl: nullToEmpty(parsed.data.logoUrl),
      primaryColor: nullToEmpty(parsed.data.primaryColor),
    });
  });
}

export async function createOfferingAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  return run(async () => {
    const { school } = await requireSchool();
    const parsed = offeringSchema.safeParse({
      ...formValues(formData, OFFERING_EDITOR_FIELDS),
      waiverNotes: "",
    });
    if (!parsed.success) {
      return errorState(
        "Check the highlighted fields and add the trial class again.",
        fieldErrorsFrom(parsed.error),
      );
    }
    const result = await insertOffering(getDb(), school.id, {
      name: parsed.data.name,
      description: parsed.data.description,
      minimumAge: parsed.data.minimumAge,
      maximumAge: parsed.data.maximumAge,
      attire: parsed.data.attire,
      expectations: parsed.data.expectations,
      waiverNotes: parsed.data.waiverNotes,
    });
    if (result.status === "success") revalidateOwnerViews(school.slug);
    return result;
  });
}

export async function updateOfferingAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  return run(async () => {
    const { school } = await requireSchool();
    const identity = updateOfferingSchema.safeParse(formValues(formData, ["id", "updatedAt"]));
    const parsed = offeringSchema.safeParse({
      ...formValues(formData, OFFERING_EDITOR_FIELDS),
      waiverNotes: "",
    });
    if (!identity.success || !parsed.success) {
      return errorState("Check the highlighted fields and save again.", {
        ...(identity.success ? {} : fieldErrorsFrom(identity.error)),
        ...(parsed.success ? {} : fieldErrorsFrom(parsed.error)),
      });
    }
    const result = await updateOffering(
      getDb(),
      school.id,
      identity.data.id,
      new Date(identity.data.updatedAt),
      {
        name: parsed.data.name,
        description: parsed.data.description,
        minimumAge: parsed.data.minimumAge,
        maximumAge: parsed.data.maximumAge,
        attire: parsed.data.attire,
        expectations: parsed.data.expectations,
      },
    );
    if (result.status === "success") revalidateOwnerViews(school.slug);
    return result;
  });
}

export async function toggleOfferingAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  return run(async () => {
    const { school } = await requireSchool();
    const parsed = toggleOfferingSchema.safeParse(formValues(formData, ["id", "active"]));
    if (!parsed.success) {
      return errorState("That trial class no longer exists. Refresh the page.");
    }
    const result = await setOfferingActive(getDb(), school.id, parsed.data.id, parsed.data.active);
    if (result.status === "success" && result.values?.unchanged !== "true") {
      revalidateOwnerViews(school.slug);
    }
    return result;
  });
}

export async function createWindowAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  return run(async () => {
    const { school } = await requireSchool();
    const parsed = windowSchema.safeParse(
      formValues(formData, [
        "trialOfferingId",
        "dayOfWeek",
        "startMinute",
        "durationMinutes",
        "capacity",
        "label",
      ]),
    );
    if (!parsed.success) {
      return errorState(
        "Check the highlighted fields and add the class time again.",
        fieldErrorsFrom(parsed.error),
      );
    }
    const db = getDb();
    const [offering] = await db
      .select({ id: trialOfferings.id })
      .from(trialOfferings)
      .where(
        and(
          eq(trialOfferings.id, parsed.data.trialOfferingId),
          eq(trialOfferings.schoolId, school.id),
        ),
      )
      .limit(1);
    if (!offering) {
      return errorState("Check the highlighted fields and try again.", {
        trialOfferingId: "Choose one of your trial classes.",
      });
    }
    await db.insert(trialWindows).values({
      schoolId: school.id,
      trialOfferingId: offering.id,
      dayOfWeek: parsed.data.dayOfWeek,
      startMinute: parsed.data.startMinute,
      durationMinutes: parsed.data.durationMinutes,
      capacity: parsed.data.capacity,
      label: parsed.data.label,
      active: true,
    });
    revalidateOwnerViews(school.slug);
    return successState("Class time added to your weekly schedule.");
  });
}

export async function deactivateWindowAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  return run(async () => {
    const { school } = await requireSchool();
    const parsed = idSchema.safeParse(formValues(formData, ["id"]));
    if (!parsed.success) {
      return errorState("That class time no longer exists. Refresh the page.");
    }
    const db = getDb();
    await db
      .update(trialWindows)
      .set({ active: false, updatedAt: new Date() })
      .where(and(eq(trialWindows.id, parsed.data.id), eq(trialWindows.schoolId, school.id)));
    revalidateOwnerViews(school.slug);
    return successState("Class time turned off. Bookings families already made are unchanged.");
  });
}

export async function updateWindowCapacityAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  return run(async () => {
    const { school } = await requireSchool();
    const parsed = capacitySchema.safeParse(formValues(formData, ["id", "capacity"]));
    if (!parsed.success) {
      return errorState("Check the number of spots and try again.", fieldErrorsFrom(parsed.error));
    }
    const { id, capacity } = parsed.data;
    const db = getDb();
    const [existing] = await db
      .select({ id: trialWindows.id })
      .from(trialWindows)
      .where(and(eq(trialWindows.id, id), eq(trialWindows.schoolId, school.id)))
      .limit(1);
    if (!existing) {
      return errorState("That class time no longer exists. Refresh the page.");
    }

    const [maxBooked] = await db
      .select({
        max: sql<number>`coalesce(max(${trialOccurrences.bookedCount}), 0)::int`,
      })
      .from(trialOccurrences)
      .where(
        and(
          eq(trialOccurrences.schoolId, school.id),
          eq(trialOccurrences.trialWindowId, id),
          gt(trialOccurrences.startAt, new Date()),
        ),
      );
    const booked = maxBooked?.max ?? 0;
    if (booked > capacity) {
      return errorState(
        `An upcoming class already has ${formatCount(booked, "student")} booked. Keep at least ${booked} spots.`,
        { capacity: `Use ${booked} or more.` },
      );
    }

    await db
      .update(trialWindows)
      .set({ capacity, updatedAt: new Date() })
      .where(and(eq(trialWindows.id, id), eq(trialWindows.schoolId, school.id)));
    await db
      .update(trialOccurrences)
      .set({ capacity, updatedAt: new Date() })
      .where(
        and(
          eq(trialOccurrences.schoolId, school.id),
          eq(trialOccurrences.trialWindowId, id),
          gt(trialOccurrences.startAt, new Date()),
          sql`${trialOccurrences.bookedCount} <= ${capacity}`,
        ),
      );
    revalidateOwnerViews(school.slug);
    return successState(`Saved. Upcoming classes now hold ${formatCount(capacity, "student")}.`, {
      capacity: String(capacity),
    });
  });
}

export async function deleteWindowAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  return run(async () => {
    const { school } = await requireSchool();
    const parsed = idSchema.safeParse(formValues(formData, ["id"]));
    if (!parsed.success) {
      return errorState("That class time no longer exists. Refresh the page.");
    }
    const db = getDb();
    const [occurrence] = await db
      .select({ id: trialOccurrences.id })
      .from(trialOccurrences)
      .where(
        and(
          eq(trialOccurrences.schoolId, school.id),
          eq(trialOccurrences.trialWindowId, parsed.data.id),
        ),
      )
      .limit(1);
    if (occurrence) {
      return errorState(
        "This class time is already on your calendar, so it cannot be deleted. Turn it off instead — upcoming bookings stay valid.",
      );
    }
    await db
      .delete(trialWindows)
      .where(and(eq(trialWindows.id, parsed.data.id), eq(trialWindows.schoolId, school.id)));
    revalidateOwnerViews(school.slug);
    return successState("Class time deleted.");
  });
}

export async function createFaqAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  return run(async () => {
    const { school } = await requireSchool();
    const parsed = faqSchema.safeParse(formValues(formData, FAQ_EDITOR_FIELDS));
    if (!parsed.success) {
      return errorState(
        "Check the highlighted fields and add the question again.",
        fieldErrorsFrom(parsed.error),
      );
    }
    const result = await insertFaq(getDb(), school.id, parsed.data);
    if (result.status === "success") revalidateOwnerViews(school.slug);
    return result;
  });
}

export async function updateFaqAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  return run(async () => {
    const { school } = await requireSchool();
    const identity = updateFaqSchema.safeParse(formValues(formData, ["id", "updatedAt"]));
    const parsed = faqSchema.safeParse(formValues(formData, FAQ_EDITOR_FIELDS));
    if (!identity.success || !parsed.success) {
      return errorState("Check the highlighted fields and save again.", {
        ...(identity.success ? {} : fieldErrorsFrom(identity.error)),
        ...(parsed.success ? {} : fieldErrorsFrom(parsed.error)),
      });
    }
    const result = await updateFaq(
      getDb(),
      school.id,
      identity.data.id,
      new Date(identity.data.updatedAt),
      parsed.data,
    );
    if (result.status === "success") revalidateOwnerViews(school.slug);
    return result;
  });
}

export async function deleteFaqAction(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  return run(async () => {
    const { school } = await requireSchool();
    const parsed = idSchema.safeParse(formValues(formData, ["id"]));
    if (!parsed.success) {
      return errorState("That question no longer exists. Refresh the page.");
    }
    const result = await deleteFaqRecord(getDb(), school.id, parsed.data.id);
    if (result.status === "success") revalidateOwnerViews(school.slug);
    return result;
  });
}
