import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { schoolDomains } from "@/db/schema";
import { schoolIssuer } from "./urls";

/** Failing domains remain live until maintenance drops them. */
export async function schoolPoppyDomains(schoolId: string): Promise<string[]> {
  if (!z.uuid().safeParse(schoolId).success) return [];
  return (
    await getDb()
      .select({ domain: schoolDomains.domain })
      .from(schoolDomains)
      .where(
        and(
          eq(schoolDomains.schoolId, schoolId),
          inArray(schoolDomains.state, ["verified", "failing"]),
        ),
      )
      .orderBy(asc(schoolDomains.domain))
  ).map(({ domain }) => domain);
}

export async function isSchoolPoppyOn(schoolId: string): Promise<boolean> {
  return (await schoolPoppyDomains(schoolId)).length > 0;
}

export async function issuerMetadata(schoolId: string) {
  const domains = await schoolPoppyDomains(schoolId);
  if (domains.length === 0) return null;
  const issuer = schoolIssuer(schoolId);
  return {
    issuer,
    token_endpoint: `${issuer}/token`,
    revocation_endpoint: `${issuer}/revoke`,
    poppy_domains: domains,
  };
}
