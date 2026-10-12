import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { emailDeliveries, schoolDomains, schools } from "@/db/schema";
import { listSchoolDomains } from "./domains";
import {
  SafeFetchError,
  type SafeFetchErrorCode,
  safeFetch,
} from "./safe-fetch";

export type DomainCheckFailure =
  | SafeFetchErrorCode
  | "not_found"
  | "check_in_progress"
  | "no_redirect"
  | "wrong_destination"
  | "copy_mismatch"
  | "claimed_by_another_school"
  | "http_error";
export type DomainCheckResult =
  | { ok: true; mode: "redirect" | "copy" }
  | { ok: false; reason: DomainCheckFailure };

function claimedDomain(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if (
    "code" in error &&
    error.code === "23505" &&
    "constraint_name" in error &&
    error.constraint_name === "school_domains_live_domain_unique"
  )
    return true;
  return "cause" in error && claimedDomain(error.cause);
}

/** Persist a fenced, expiring lease so another instance can serve pending discovery. */
export async function checkSchoolDomain(
  schoolId: string,
  domain: string,
  { dropFailing = false }: { dropFailing?: boolean } = {},
): Promise<DomainCheckResult> {
  const db = getDb();
  const connection = (await listSchoolDomains(schoolId)).find(
    (row) => row.domain === domain,
  );
  if (!connection) return { ok: false, reason: "not_found" };
  const checkId = randomUUID();
  const predicate = and(
    eq(schoolDomains.id, connection.id),
    eq(schoolDomains.schoolId, schoolId),
    eq(schoolDomains.checkId, checkId),
  );
  const [claimed] = await db
    .update(schoolDomains)
    .set({ checkId, checkingUntil: new Date(Date.now() + 15000) })
    .where(
      and(
        eq(schoolDomains.id, connection.id),
        eq(schoolDomains.schoolId, schoolId),
        dropFailing
          ? inArray(schoolDomains.state, ["verified", "failing"])
          : undefined,
        or(
          isNull(schoolDomains.checkingUntil),
          lt(schoolDomains.checkingUntil, new Date()),
        ),
      ),
    )
    .returning({ id: schoolDomains.id });
  if (!claimed) return { ok: false, reason: "check_in_progress" };
  try {
    let result: DomainCheckResult;
    try {
      const response = await safeFetch(connection.sourceUrl, {
        maxRedirects: 5,
      });
      if (response.status !== 200) result = { ok: false, reason: "http_error" };
      else if (response.url === connection.discoveryUrl)
        result = { ok: true, mode: "redirect" };
      else if (
        response.headers
          .get("content-type")
          ?.split(";")[0]
          ?.trim()
          .toLowerCase() === "application/json" &&
        response.body.equals(Buffer.from(connection.document))
      )
        result = { ok: true, mode: "copy" };
      else
        result = {
          ok: false,
          reason:
            response.url !== connection.sourceUrl
              ? "wrong_destination"
              : response.headers
                    .get("content-type")
                    ?.toLowerCase()
                    .startsWith("application/json")
                ? "copy_mismatch"
                : "no_redirect",
        };
    } catch (error) {
      if (!(error instanceof SafeFetchError)) throw error;
      result = { ok: false, reason: error.code };
    }
    const now = new Date();
    if (result.ok) {
      try {
        const [updated] = await db
          .update(schoolDomains)
          .set({
            state: "verified",
            mode: result.mode,
            verifiedAt: connection.verifiedAt ?? now,
            lastCheckedAt: now,
            lastCheckResult: "passed",
            consecutiveFailures: 0,
          })
          .where(and(predicate, gt(schoolDomains.checkingUntil, now)))
          .returning({ id: schoolDomains.id });
        if (!updated) return { ok: false, reason: "not_found" };
      } catch (error) {
        if (!claimedDomain(error)) throw error;
        result = { ok: false, reason: "claimed_by_another_school" };
      }
    }
    if (!result.ok) {
      const reason = result.reason;
      await db.transaction(async (tx) => {
        const [failed] = await tx
          .update(schoolDomains)
          .set({
            lastCheckedAt: now,
            lastCheckResult: reason,
            consecutiveFailures: sql`${schoolDomains.consecutiveFailures} + 1`,
            state: connection.state === "pending" ? "pending" : "failing",
          })
          .where(and(predicate, gt(schoolDomains.checkingUntil, now)))
          .returning();
        if (!failed || !dropFailing || failed.consecutiveFailures < 3) return;
        const [school] = await tx
          .select()
          .from(schools)
          .where(eq(schools.id, schoolId));
        if (!school) throw new Error("school_missing");
        await tx.insert(emailDeliveries).values({
          schoolId,
          kind: "owner_poppy_domain_dropped",
          domainSnapshot: failed.domain,
          recipient: school.notificationEmail,
          providerIdempotencyKey: `poppy-domain-dropped/${failed.id}`,
          nextAttemptAt: now,
        });
        await tx.delete(schoolDomains).where(predicate);
      });
    }
    return result;
  } finally {
    await db
      .update(schoolDomains)
      .set({ checkId: null, checkingUntil: null })
      .where(predicate);
  }
}
