import "server-only";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

// Keep the existing domain shape for booking, chat and scheduling callers.
// Database rows and queries use the generated Supabase types, not Drizzle.
async function findSchool(slug: string, publishedOnly: boolean) {
  const supabase = createAdminClient();
  let query = supabase.from("schools").select("*, school_settings(*)").eq("slug", slug);
  if (publishedOnly) {
    query = query.not("approved_at", "is", null).not("published_at", "is", null);
  }
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const settings = data.school_settings;
  if (!settings) throw new Error("School settings are missing");

  return {
    id: data.id,
    ownerUserId: data.owner_user_id,
    slug: data.slug,
    timezone: data.timezone,
    approvedAt: data.approved_at ? new Date(data.approved_at) : null,
    publishedAt: data.published_at ? new Date(data.published_at) : null,
    previewedAt: data.previewed_at ? new Date(data.previewed_at) : null,
    createdAt: new Date(data.created_at),
    updatedAt: new Date(data.updated_at),
    whatsappPhoneNumberId: data.whatsapp_phone_number_id,
    whatsappWabaId: data.whatsapp_waba_id,
    name: settings.name,
    notificationEmail: settings.notification_email,
    phone: settings.phone,
    website: settings.website,
    address: settings.address,
    country: settings.country,
    city: settings.city,
    parkingNotes: settings.parking_notes,
    accessNotes: settings.access_notes,
    trialGuidance: settings.trial_guidance,
    pricing: settings.pricing,
    welcomeMessage: settings.welcome_message,
    agentInstructions: settings.agent_instructions,
    logoUrl: settings.logo_url,
    primaryColor: settings.primary_color,
  };
}

export async function getSchoolBySlug(slug: string) {
  return findSchool(slug, false);
}

export async function getSchoolForLandingAccess(slug: string, options?: { preview?: boolean }) {
  const publicSchool = await getPublicSchoolBySlug(slug);
  if (publicSchool) return publicSchool;
  if (!options?.preview) return null;
  const user = await getCurrentUser();
  if (!user) return null;
  const school = await getSchoolBySlug(slug);
  if (!school || school.ownerUserId !== user.id) return null;
  return school;
}

export async function getPublicSchoolBySlug(slug: string) {
  return findSchool(slug, true);
}

// PostgREST caps each response; catalogs must not silently lose later rows.
async function readAll<Row>(query: {
  range: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: unknown }>;
}): Promise<Row[]> {
  const rows: Row[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await query.range(offset, offset + pageSize - 1);
    if (error) throw error;
    if (!data) throw new Error("School catalog response is missing");
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}

export async function loadSchoolCatalog(schoolId: string) {
  const supabase = createAdminClient();
  const [offerings, windows, occurrences, faqs] = await Promise.all([
    readAll(supabase.from("trial_offerings").select("*").eq("school_id", schoolId).order("id")),
    readAll(supabase.from("trial_windows").select("*").eq("school_id", schoolId).order("id")),
    readAll(supabase.from("trial_occurrences").select("*").eq("school_id", schoolId).order("id")),
    readAll(
      supabase.from("faqs").select("*").eq("school_id", schoolId).order("sort_order").order("id"),
    ),
  ]);

  return {
    offerings: offerings.map((row) => ({
      id: row.id,
      schoolId: row.school_id,
      name: row.name,
      description: row.description,
      minimumAge: row.minimum_age,
      maximumAge: row.maximum_age,
      expectations: row.expectations,
      attire: row.attire,
      waiverNotes: row.waiver_notes,
      active: row.active,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    })),
    windows: windows.map((row) => ({
      id: row.id,
      schoolId: row.school_id,
      trialOfferingId: row.trial_offering_id,
      dayOfWeek: row.day_of_week,
      startMinute: row.start_minute,
      durationMinutes: row.duration_minutes,
      capacity: row.capacity,
      label: row.label,
      active: row.active,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    })),
    occurrences: occurrences.map((row) => ({
      id: row.id,
      schoolId: row.school_id,
      trialWindowId: row.trial_window_id,
      trialOfferingId: row.trial_offering_id,
      startAt: new Date(row.start_at),
      endAt: new Date(row.end_at),
      capacity: row.capacity,
      bookedCount: row.booked_count,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    })),
    faqs: faqs.map((row) => ({
      id: row.id,
      schoolId: row.school_id,
      question: row.question,
      answer: row.answer,
      sortOrder: row.sort_order,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    })),
  };
}
