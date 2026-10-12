import { and, eq, gt, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { schoolDomains, schools } from "@/db/schema";
import { discoveryDocument } from "./discovery-document";
import { normalizePoppyDomain } from "./domain";

export async function readDiscovery(schoolId: string, input: string) {
  const domain = normalizePoppyDomain(input);
  if (!domain || !z.uuid().safeParse(schoolId).success) return null;
  const [row] = await getDb()
    .select({ id: schools.id, name: schools.name, state: schoolDomains.state })
    .from(schoolDomains)
    .innerJoin(schools, eq(schools.id, schoolDomains.schoolId))
    .where(
      and(
        eq(schoolDomains.schoolId, schoolId),
        eq(schoolDomains.domain, domain),
        or(
          inArray(schoolDomains.state, ["verified", "failing"]),
          gt(schoolDomains.checkingUntil, new Date()),
        ),
      ),
    )
    .limit(1);
  return row
    ? {
        document: discoveryDocument(row, domain),
        pending: row.state === "pending",
      }
    : null;
}
