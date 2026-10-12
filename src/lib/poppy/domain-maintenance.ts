import { inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { schoolDomains } from "@/db/schema";
import { checkSchoolDomain } from "./domain-check";

/** Both verified and failing domains remain live until maintenance drops them. */
export async function recheckSchoolDomains() {
  const connections = await getDb()
    .select({ schoolId: schoolDomains.schoolId, domain: schoolDomains.domain })
    .from(schoolDomains)
    .where(inArray(schoolDomains.state, ["verified", "failing"]));
  for (const connection of connections) {
    try {
      await checkSchoolDomain(connection.schoolId, connection.domain, {
        dropFailing: true,
      });
    } catch {
      console.error(
        JSON.stringify({
          event: "poppy_domain_recheck_failed",
          schoolId: connection.schoolId,
          domain: connection.domain,
        }),
      );
    }
  }
}
