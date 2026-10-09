import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { schools, trialOfferings, users } from "@/db/schema";
import {
  type authSql,
  deleteAuthUser,
  insertAuthUser,
  requireRow,
} from "./integration-env";

type Sql = ReturnType<typeof authSql>;

/**
 * Seeds an approved school in America/New_York, its owner (emailed at
 * `<slug>@local.test`) and the given trial offerings. Returns the school id
 * and the offering ids in order. `deleteSchoolOwner` removes it all again.
 */
export async function seedSchool(
  sql: Sql,
  {
    ownerId,
    offerings,
    ...school
  }: Pick<
    typeof schools.$inferInsert,
    "name" | "slug" | "phone" | "publishedAt" | "whatsappPhoneNumberId"
  > & {
    ownerId: string;
    offerings: Array<Omit<typeof trialOfferings.$inferInsert, "schoolId">>;
  },
) {
  const db = getDb();
  const email = `${school.slug}@local.test`;
  await insertAuthUser(sql, ownerId, email);
  await db
    .insert(users)
    .values({ id: ownerId, email, name: `${school.name} Owner` });
  const [row] = await db
    .insert(schools)
    .values({
      ...school,
      ownerUserId: ownerId,
      timezone: "America/New_York",
      notificationEmail: email,
      approvedAt: new Date(),
    })
    .returning({ id: schools.id });
  const schoolId = requireRow(row, "school").id;
  const offeringRows = await db
    .insert(trialOfferings)
    .values(offerings.map((offering) => ({ ...offering, schoolId })))
    .returning({ id: trialOfferings.id });
  return { schoolId, offeringIds: offeringRows.map(({ id }) => id) };
}

/** Deletes a seeded school's owner, which cascades to the school. */
export async function deleteSchoolOwner(sql: Sql, ownerId: string) {
  await getDb().delete(users).where(eq(users.id, ownerId));
  await deleteAuthUser(sql, ownerId);
}
