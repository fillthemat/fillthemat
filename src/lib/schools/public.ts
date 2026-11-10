import "server-only";
import type { SchoolCatalog } from "@/lib/ai/context";
import { createClient } from "@/lib/supabase/server";

// Public domain shape for booking/chat callers; database queries remain typed
// with generated Supabase rows and never load private school settings.
export type LandingSchool = {
  id: string;
  slug: string;
  timezone: string;
  approvedAt: Date | null;
  publishedAt: Date | null;
  name: string;
  phone: string | null;
  website: string | null;
  address: string | null;
  country: string;
  city: string | null;
  parkingNotes: string | null;
  accessNotes: string | null;
  trialGuidance: string | null;
  pricing: string | null;
  welcomeMessage: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
};

async function findSchool(slug: string, preview: boolean): Promise<LandingSchool | null> {
  const supabase = await createClient();
  let query = supabase.from("schools").select("*, school_profiles!inner(*)").eq("slug", slug);
  if (!preview) query = query.not("approved_at", "is", null).not("published_at", "is", null);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const profile = data.school_profiles;

  return {
    id: data.id,
    slug: data.slug,
    timezone: data.timezone,
    approvedAt: data.approved_at ? new Date(data.approved_at) : null,
    publishedAt: data.published_at ? new Date(data.published_at) : null,
    name: profile.name,
    phone: profile.phone,
    website: profile.website,
    address: profile.address,
    country: profile.country,
    city: profile.city,
    parkingNotes: profile.parking_notes,
    accessNotes: profile.access_notes,
    trialGuidance: profile.trial_guidance,
    pricing: profile.pricing,
    welcomeMessage: profile.welcome_message,
    logoUrl: profile.logo_url,
    primaryColor: profile.primary_color,
  };
}

export async function getSchoolBySlug(slug: string) {
  return findSchool(slug, true);
}

export async function getSchoolForLandingAccess(slug: string, options?: { preview?: boolean }) {
  return findSchool(slug, options?.preview === true);
}

export async function getPublicSchoolBySlug(slug: string) {
  return findSchool(slug, false);
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

export async function loadSchoolCatalog(
  schoolId: string,
  options?: { anonymous?: boolean },
): Promise<SchoolCatalog> {
  const supabase = await createClient(options);
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
      name: row.name,
      description: row.description,
      minimumAge: row.minimum_age,
      maximumAge: row.maximum_age,
      expectations: row.expectations,
      attire: row.attire,
      active: row.active,
    })),
    windows: windows.map((row) => ({
      id: row.id,
      trialOfferingId: row.trial_offering_id,
      dayOfWeek: row.day_of_week,
      startMinute: row.start_minute,
      durationMinutes: row.duration_minutes,
      capacity: row.capacity,
      label: row.label,
      active: row.active,
    })),
    occurrences: occurrences.map((row) => ({
      trialWindowId: row.trial_window_id,
      startAt: new Date(row.start_at),
      capacity: row.capacity,
      bookedCount: row.booked_count,
    })),
    faqs: faqs.map((row) => ({
      question: row.question,
      answer: row.answer,
    })),
  };
}
