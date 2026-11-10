import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { hashToken } from "@/lib/crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { authSql, loadLocalEnv } from "@/test/integration-env";
import { deletePublicSchoolOwner, seedPublicSchool } from "@/test/seed-public-school";

vi.mock("server-only", () => ({}));
loadLocalEnv();
const sql = authSql();
const ownerId = randomUUID();
let schoolId = "";

beforeAll(async () => {
  schoolId = (
    await seedPublicSchool(sql, {
      ownerId,
      slug: ownerId,
      name: "Landing sessions",
      publishedAt: new Date(),
      offerings: [],
    })
  ).schoolId;
});
afterAll(async () => {
  await deletePublicSchoolOwner(sql, ownerId);
  await sql.end();
});

it.each(["anon", "authenticated"])("denies execution to %s", async (role) => {
  await expect(
    sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL ROLE ${role}`);
      await tx`SELECT public.record_landing_session(${schoolId}::uuid, 'forged', false)`;
    }),
  ).rejects.toMatchObject({ code: "42501" });
});

it("records one session and qualification event for concurrent first visits", async () => {
  const sessionKeyHash = hashToken(randomUUID());
  const admin = createAdminClient();
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      admin.rpc("record_landing_session", {
        p_school_id: schoolId,
        p_session_key_hash: sessionKeyHash,
        p_is_preview: false,
      }),
    ),
  );
  for (const result of results) {
    expect(result.error).toBeNull();
    expect(result.data).toBe(true);
  }
  const { data: sessions, error } = await admin
    .from("landing_sessions")
    .select("id, qualified_at")
    .eq("school_id", schoolId)
    .eq("session_key_hash", sessionKeyHash);
  expect(error).toBeNull();
  expect(sessions).toHaveLength(1);
  expect(sessions?.[0]?.qualified_at).not.toBeNull();
  const { data: events, error: eventError } = await admin
    .from("funnel_events")
    .select("event_type")
    .eq("school_id", schoolId)
    .eq("landing_session_id", sessions![0]!.id);
  expect(eventError).toBeNull();
  expect(events).toEqual([{ event_type: "session_qualified" }]);
});
