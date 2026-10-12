import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { schoolDomains, schools } from "@/db/schema";
import { discoveryDocument } from "./discovery-document";
import { normalizePoppyDomain } from "./domain";
import { schoolDiscoveryUrl } from "./urls";

export async function connectSchoolDomain(schoolId: string, input: string) {
  const domain = normalizePoppyDomain(input);
  if (!domain) return { error: "invalid_domain" } as const;
  await getDb()
    .insert(schoolDomains)
    .values({ schoolId, domain })
    .onConflictDoNothing({
      target: [schoolDomains.schoolId, schoolDomains.domain],
    });
  return { domain };
}

export async function removeSchoolDomain(schoolId: string, domain: string) {
  await getDb()
    .delete(schoolDomains)
    .where(
      and(
        eq(schoolDomains.schoolId, schoolId),
        eq(schoolDomains.domain, domain),
      ),
    );
}

export async function listSchoolDomains(schoolId: string) {
  const rows = await getDb()
    .select({ connection: schoolDomains, name: schools.name })
    .from(schoolDomains)
    .innerJoin(schools, eq(schools.id, schoolDomains.schoolId))
    .where(eq(schoolDomains.schoolId, schoolId))
    .orderBy(asc(schoolDomains.domain));
  return rows.map(({ connection, name }) => ({
    ...connection,
    sourceUrl: `https://${connection.domain}/.well-known/poppy.json`,
    discoveryUrl: schoolDiscoveryUrl(schoolId, connection.domain),
    document: discoveryDocument({ id: schoolId, name }, connection.domain),
  }));
}
