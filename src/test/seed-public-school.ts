import { type authSql, deleteAuthUser, insertAuthUser, requireRow } from "./integration-env";

/** Native Data API fixtures; never use the parallel legacy app schema. */
export async function seedPublicSchool(
  sql: ReturnType<typeof authSql>,
  school: {
    ownerId: string;
    name: string;
    slug: string;
    phone?: string;
    publishedAt?: Date;
    offerings: Array<{
      name: string;
      description?: string;
      minimumAge?: number;
      maximumAge?: number;
      active?: boolean;
    }>;
  },
) {
  const email = `${school.slug}@local.test`;
  await insertAuthUser(sql, school.ownerId, email);
  await sql`INSERT INTO public.users (id, email) VALUES (${school.ownerId}, ${email})`;
  const id = requireRow(
    (
      await sql`INSERT INTO public.schools (slug, timezone, approved_at, published_at)
    VALUES (${school.slug}, 'America/New_York', now(), ${school.publishedAt ?? null}) RETURNING id`
    )[0],
    "school",
  ).id as string;
  await sql`INSERT INTO public.school_settings (school_id, owner_user_id, notification_email)
    VALUES (${id}, ${school.ownerId}, ${email})`;
  await sql`INSERT INTO public.school_profiles (school_id, name, phone) VALUES (${id}, ${school.name}, ${school.phone ?? null})`;
  const offeringIds: string[] = [];
  for (const offering of school.offerings) {
    const row = requireRow(
      (
        await sql`INSERT INTO public.trial_offerings (school_id, name, description, minimum_age, maximum_age, active)
      VALUES (${id}, ${offering.name}, ${offering.description ?? null}, ${offering.minimumAge ?? null}, ${offering.maximumAge ?? null}, ${offering.active ?? true}) RETURNING id`
      )[0],
      "offering",
    );
    offeringIds.push(row.id as string);
  }
  return { schoolId: id, offeringIds };
}

export async function deletePublicSchoolOwner(sql: ReturnType<typeof authSql>, ownerId: string) {
  await deleteAuthUser(sql, ownerId);
}
