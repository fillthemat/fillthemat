import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { POST } from "@/app/api/bookings/route";
import { authSql, loadLocalEnv } from "@/test/integration-env";
import { deletePublicSchoolOwner, seedPublicSchool } from "@/test/seed-public-school";
import { recipientQuotaExceeded } from "./limits";

vi.mock("server-only", () => ({}));
// Supply an anonymous request context outside Next; database access stays real.
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [] }) }));
// The external CAPTCHA is unrelated to the database quota.
vi.mock("@/lib/security/turnstile", () => ({ verifyTurnstile: async () => true }));
loadLocalEnv();
const sql = authSql();
const ownerId = randomUUID();
const slug = `quota-${ownerId}`;
const recipient = `${ownerId}@local.test`;
let schoolId = "";
let offeringId = "";

beforeAll(async () => {
  const school = await seedPublicSchool(sql, {
    ownerId,
    slug,
    name: "Quota test",
    publishedAt: new Date(),
    offerings: [{ name: "Trial" }],
  });
  schoolId = school.schoolId;
  offeringId = school.offeringIds[0]!;
});
afterAll(async () => {
  await deletePublicSchoolOwner(sql, ownerId);
  await sql.end();
});

function request() {
  return new Request("http://localhost/api/bookings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      schoolSlug: slug,
      offeringId,
      slotId: "nonexistent-slot",
      idempotencyKey: randomUUID(),
      contact: { name: "Quota", email: recipient, phone: "555-0100" },
      participant: { name: "Student", age: 10 },
      turnstileToken: "test",
    }),
  });
}

it("counts public deliveries in the rolling day and preserves the API rate_limited code", async () => {
  // Historical deliveries and a different recipient must not consume this budget.
  await sql`INSERT INTO public.email_deliveries
    (school_id, kind, recipient, provider_idempotency_key, created_at)
    SELECT ${schoolId}, 'prospect_confirmation', ${recipient}, gen_random_uuid()::text,
      now() - interval '25 hours' FROM generate_series(1, 13)`;
  await sql`INSERT INTO public.email_deliveries
    (school_id, kind, recipient, provider_idempotency_key)
    SELECT ${schoolId}, 'prospect_confirmation', 'other@local.test', gen_random_uuid()::text
      FROM generate_series(1, 13)`;
  expect(await recipientQuotaExceeded(schoolId, recipient)).toBe(false);
  const below = await POST(request());
  expect(below.status).toBe(400);
  expect(await below.json()).toMatchObject({ error: "invalid_slot" });

  await sql`INSERT INTO public.email_deliveries
    (school_id, kind, recipient, provider_idempotency_key)
    SELECT ${schoolId}, 'prospect_confirmation', ${recipient}, gen_random_uuid()::text
      FROM generate_series(1, 13)`;
  expect(await recipientQuotaExceeded(schoolId, recipient)).toBe(true);
  const above = await POST(request());
  expect(above.status).toBe(429);
  expect(await above.json()).toMatchObject({ error: "rate_limited" });
  expect(await recipientQuotaExceeded(randomUUID(), recipient)).toBe(false);
});
