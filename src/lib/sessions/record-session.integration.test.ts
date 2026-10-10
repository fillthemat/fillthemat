import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/sessions/route";
import { getDb } from "@/db";
import { funnelEvents, landingSessions, schools } from "@/db/schema";
import { hashToken } from "@/lib/crypto";
import { FUNNEL_EVENTS } from "@/lib/funnel";
import { recordLandingSession } from "@/lib/sessions/record-session";
import { authSql, loadLocalEnv, requireRow } from "@/test/integration-env";
import { deleteSchoolOwner, seedSchool } from "@/test/seed-school";

loadLocalEnv();
const db = getDb();
const sql = authSql();
const ownerId = randomUUID();
const slug = `sessions-${randomUUID()}`;
let schoolId = "";

beforeAll(async () => {
  ({ schoolId } = await seedSchool(sql, {
    ownerId,
    slug,
    name: "Sessions School",
    publishedAt: new Date(),
    offerings: [{ name: "Trial" }],
  }));
});

afterAll(async () => {
  await deleteSchoolOwner(sql, ownerId);
  await sql.end({ timeout: 5 });
});

describe("recordLandingSession", () => {
  it("qualifies a public landing visit and records its attribution and funnel event", async () => {
    const token = randomUUID();
    expect(
      await recordLandingSession({
        slug,
        token,
        userAgent: "Mozilla/5.0",
        utm: { utm_source: "search", utm_campaign: "x".repeat(250) },
      }),
    ).toEqual({ status: "recorded", qualified: true });
    const sessions = await db
      .select()
      .from(landingSessions)
      .where(eq(landingSessions.schoolId, schoolId));
    expect(sessions).toHaveLength(1);
    const session = requireRow(sessions[0], "landing session");
    expect(session.utmSource).toBe("search");
    expect(session.utmCampaign).toHaveLength(200);
    expect(session.qualifiedAt).not.toBeNull();
    const events = await db
      .select()
      .from(funnelEvents)
      .where(eq(funnelEvents.landingSessionId, session.id));
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe(FUNNEL_EVENTS.sessionQualified);
    expect(events[0]?.metadata).toEqual({ source: "landing" });
  });

  it.each([
    { preview: true, userAgent: "Mozilla/5.0", botReason: null },
    { preview: false, userAgent: "Googlebot", botReason: "user_agent" },
  ])(
    "does not qualify previews or known bots: %j",
    async ({ preview, userAgent, botReason }) => {
      const token = randomUUID();
      expect(
        await recordLandingSession({ slug, token, preview, userAgent }),
      ).toEqual({ status: "recorded", qualified: false });
      const [session] = await db
        .select()
        .from(landingSessions)
        .where(eq(landingSessions.sessionKeyHash, hashToken(token)));
      expect(session?.isPreview).toBe(preview);
      expect(session?.botExclusionReason).toBe(botReason);
      expect(session?.qualifiedAt).toBeNull();
      const events = await db
        .select()
        .from(funnelEvents)
        .where(
          eq(funnelEvents.landingSessionId, requireRow(session, "session").id),
        );
      expect(events).toHaveLength(0);
    },
  );

  it.each(["approvedAt", "publishedAt"] as const)(
    "does not qualify schools without %s",
    async (field) => {
      await db
        .update(schools)
        .set({ [field]: null })
        .where(eq(schools.id, schoolId));
      try {
        expect(
          await recordLandingSession({
            slug,
            token: randomUUID(),
            userAgent: null,
          }),
        ).toEqual({ status: "recorded", qualified: false });
      } finally {
        await db
          .update(schools)
          .set({ [field]: new Date() })
          .where(eq(schools.id, schoolId));
      }
    },
  );

  it("refreshes a stale key without changing its original attribution or qualification", async () => {
    const token = randomUUID();
    await recordLandingSession({
      slug,
      token,
      preview: true,
      userAgent: null,
      utm: { utm_source: "original" },
    });
    const [original] = await db
      .select()
      .from(landingSessions)
      .where(eq(landingSessions.sessionKeyHash, hashToken(token)));
    const session = requireRow(original, "session");
    const staleAt = new Date("2025-01-01T00:00:00Z");
    await db
      .update(landingSessions)
      .set({ lastSeenAt: staleAt })
      .where(eq(landingSessions.id, session.id));
    expect(
      await recordLandingSession({
        slug,
        token,
        userAgent: null,
        utm: { utm_source: "replacement" },
      }),
    ).toEqual({ status: "recorded", qualified: false });
    const rows = await db
      .select()
      .from(landingSessions)
      .where(eq(landingSessions.sessionKeyHash, hashToken(token)));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(session.id);
    expect(rows[0]?.utmSource).toBe("original");
    expect(rows[0]?.isPreview).toBe(true);
    expect(rows[0]?.firstSeenAt).toEqual(session.firstSeenAt);
    expect(rows[0]?.lastSeenAt.getTime()).toBeGreaterThan(staleAt.getTime());
    const events = await db
      .select()
      .from(funnelEvents)
      .where(eq(funnelEvents.landingSessionId, session.id));
    expect(events).toHaveLength(0);
  });

  it("reuses a qualified visit and handles concurrent first visits without duplicate funnel events", async () => {
    const token = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        recordLandingSession({ slug, token, userAgent: null }),
      ),
    );
    expect(results).toEqual(
      Array.from({ length: 5 }, () => ({
        status: "recorded",
        qualified: true,
      })),
    );
    expect(
      await recordLandingSession({
        slug,
        token,
        preview: true,
        userAgent: "Googlebot",
      }),
    ).toEqual({ status: "recorded", qualified: true });
    const sessions = await db
      .select()
      .from(landingSessions)
      .where(eq(landingSessions.sessionKeyHash, hashToken(token)));
    expect(sessions).toHaveLength(1);
    const events = await db
      .select()
      .from(funnelEvents)
      .where(
        eq(
          funnelEvents.landingSessionId,
          requireRow(sessions[0], "session").id,
        ),
      );
    expect(events).toHaveLength(1);
  });

  it("returns not_found for an unknown school and saves no visit", async () => {
    const token = randomUUID();
    expect(
      await recordLandingSession({
        slug: `missing-${randomUUID()}`,
        token,
        userAgent: null,
      }),
    ).toEqual({ status: "not_found" });
    expect(
      await db
        .select()
        .from(landingSessions)
        .where(eq(landingSessions.sessionKeyHash, hashToken(token))),
    ).toHaveLength(0);
  });
});

describe("sessions HTTP adapter", () => {
  function request(body: unknown) {
    return new Request("http://localhost/api/sessions", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  it.each([{}, { slug }, { slug, token: "short" }, { token: randomUUID() }])(
    "keeps invalid-input responses: %j",
    async (body) => {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid" });
    },
  );

  it("maps unknown schools to the original 404 response", async () => {
    const response = await POST(
      request({ slug: `missing-${randomUUID()}`, token: randomUUID() }),
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  it("keeps the successful qualified response", async () => {
    const response = await POST(request({ slug, token: randomUUID() }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, qualified: true });
  });
});
