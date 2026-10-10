import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { funnelEvents, landingSessions, schools } from "@/db/schema";
import { hashToken } from "@/lib/crypto";
import { FUNNEL_EVENTS } from "@/lib/funnel";
import { isKnownBot } from "@/lib/request";

type LandingSessionInput = {
  slug: string;
  token: string;
  preview?: boolean;
  utm?: Record<string, string | undefined>;
  userAgent: string | null;
};

type LandingSessionResult =
  | { status: "not_found" }
  | { status: "recorded"; qualified: boolean };

/** Records a landing visit; a reused key is never requalified. */
export async function recordLandingSession(
  input: LandingSessionInput,
): Promise<LandingSessionResult> {
  const db = getDb();
  const [school] = await db
    .select()
    .from(schools)
    .where(eq(schools.slug, input.slug))
    .limit(1);
  if (!school) return { status: "not_found" };

  const botReason = isKnownBot(input.userAgent);
  const isPreview = Boolean(input.preview);
  const hash = hashToken(input.token);
  const now = new Date();
  const identity = and(
    eq(landingSessions.schoolId, school.id),
    eq(landingSessions.sessionKeyHash, hash),
  );
  const [existing] = await db
    .select()
    .from(landingSessions)
    .where(identity)
    .limit(1);

  let session = existing;
  if (!session) {
    const qualified =
      !isPreview &&
      !botReason &&
      school.approvedAt != null &&
      school.publishedAt != null;
    const [created] = await db
      .insert(landingSessions)
      .values({
        schoolId: school.id,
        sessionKeyHash: hash,
        firstSeenAt: now,
        lastSeenAt: now,
        qualifiedAt: qualified ? now : null,
        utmSource: input.utm?.utm_source?.slice(0, 200) ?? null,
        utmMedium: input.utm?.utm_medium?.slice(0, 200) ?? null,
        utmCampaign: input.utm?.utm_campaign?.slice(0, 200) ?? null,
        utmContent: input.utm?.utm_content?.slice(0, 200) ?? null,
        utmTerm: input.utm?.utm_term?.slice(0, 200) ?? null,
        isPreview,
        botExclusionReason: botReason,
      })
      .onConflictDoNothing({
        target: [landingSessions.schoolId, landingSessions.sessionKeyHash],
      })
      .returning();
    session = created;
    if (!session) {
      const [again] = await db
        .select()
        .from(landingSessions)
        .where(identity)
        .limit(1);
      session = again;
    } else if (session.qualifiedAt) {
      await db.insert(funnelEvents).values({
        schoolId: school.id,
        landingSessionId: session.id,
        eventType: FUNNEL_EVENTS.sessionQualified,
        metadata: { source: "landing" },
      });
    }
  } else {
    await db
      .update(landingSessions)
      .set({ lastSeenAt: now, updatedAt: now })
      .where(eq(landingSessions.id, session.id));
  }

  return { status: "recorded", qualified: Boolean(session?.qualifiedAt) };
}
