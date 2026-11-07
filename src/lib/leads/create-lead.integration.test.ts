import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { hashToken, hashWaId } from "@/lib/crypto";
import { authSql, loadLocalEnv, requireRow } from "@/test/integration-env";
import { deletePublicSchoolOwner, seedPublicSchool } from "@/test/seed-public-school";
import { createLead, type CreateLeadInput, ownerLeadQuotaExceeded } from "./create-lead";

vi.mock("server-only", () => ({}));
loadLocalEnv();
const sql = authSql();
const ownerId = randomUUID();
const otherOwnerId = randomUUID();
const token = randomUUID();
let schoolId = "";
let offeringId = "";
let otherSchoolId = "";
let otherOfferingId = "";
let sessionId = "";
let input: CreateLeadInput;

beforeAll(async () => {
  const school = await seedPublicSchool(sql, {
    ownerId,
    slug: `lead-${ownerId}`,
    name: "Lead school",
    publishedAt: new Date(),
    offerings: [{ name: "Trial" }],
  });
  schoolId = school.schoolId;
  offeringId = school.offeringIds[0]!;
  const other = await seedPublicSchool(sql, {
    ownerId: otherOwnerId,
    slug: `lead-${otherOwnerId}`,
    name: "Draft school",
    offerings: [{ name: "Other trial" }],
  });
  otherSchoolId = other.schoolId;
  otherOfferingId = other.offeringIds[0]!;
  sessionId = requireRow(
    (
      await sql`INSERT INTO public.landing_sessions (school_id, session_key_hash)
    VALUES (${schoolId}, ${hashToken(token)}) RETURNING id`
    )[0],
    "session",
  ).id;
  input = {
    school: { id: schoolId },
    contact: { name: " Parent ", email: " PARENT@local.test ", phone: " 555-lead " },
    source: { channel: "web", landingSessionToken: token },
    participantName: "Student",
    participantAge: 10,
    offeringId,
    statedNeed: "A trial",
  };
});
afterAll(async () => {
  await deletePublicSchoolOwner(sql, ownerId);
  await deletePublicSchoolOwner(sql, otherOwnerId);
  await sql.end();
});

it("creates exactly one of each effect per submission, reusing the normalized contact and landing session", async () => {
  const first = await createLead(input);
  const second = await createLead({ ...input, contact: { ...input.contact, name: "Updated" } });
  // Lead requests have never had a replay key: duplicates create distinct leads.
  expect(first.id).not.toBe(second.id);
  expect(first.contact_id).toBe(second.contact_id);
  expect(first.landing_session_id).toBe(sessionId);
  expect(first).toMatchObject({
    participant_name: "Student",
    participant_age: 10,
    trial_offering_id: offeringId,
    stated_need: "A trial",
    status: "open",
  });
  const contacts = await sql`SELECT * FROM public.contacts WHERE school_id = ${schoolId}`;
  expect(contacts).toHaveLength(1);
  expect(contacts[0]).toMatchObject({
    name: "Updated",
    email: "parent@local.test",
    phone: "555-lead",
  });
  for (const lead of [first, second]) {
    const deliveries = await sql`SELECT * FROM public.email_deliveries WHERE lead_id = ${lead.id}`;
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      kind: "owner_lead",
      state: "pending",
      recipient: `lead-${ownerId}@local.test`,
      provider_idempotency_key: `owner-lead/${lead.id}`,
    });
    const events = await sql`SELECT * FROM public.funnel_events WHERE lead_id = ${lead.id}`;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event_type: "lead_captured",
      landing_session_id: sessionId,
      metadata: { hasOffering: true },
    });
  }
});

it("reuses WhatsApp phone contacts and stable pseudo-sessions", async () => {
  const waInput: CreateLeadInput = {
    ...input,
    contact: { name: "Guest", email: null, phone: "1555000251" },
    source: { channel: "whatsapp", waId: "1555000251" },
    offeringId: null,
  };
  const [first, second] = await Promise.all([createLead(waInput), createLead(waInput)]);
  expect(first.contact_id).toBe(second.contact_id);
  expect(first.landing_session_id).toBe(second.landing_session_id);
  const sessions =
    await sql`SELECT * FROM public.landing_sessions WHERE id = ${first.landing_session_id}`;
  expect(sessions[0]).toMatchObject({
    utm_source: "whatsapp",
    is_preview: false,
    session_key_hash: hashWaId("whatsapp-landing:1555000251"),
  });
  const events = await sql`SELECT * FROM public.funnel_events WHERE lead_id = ${first.id}`;
  expect(events[0]?.metadata).toEqual({ channel: "whatsapp", hasOffering: false });
});

it("rejects unpublished schools, missing/cross-school sessions and cross-school offerings without contact effects", async () => {
  const contact = { name: "Rejected", email: "rejected@local.test", phone: "rejected" };
  await expect(
    createLead({ ...input, contact, school: { id: otherSchoolId } }),
  ).rejects.toMatchObject({ message: "school_not_public" });
  for (const landingSessionToken of [undefined, randomUUID()]) {
    await expect(
      createLead({ ...input, contact, source: { channel: "web", landingSessionToken } }),
    ).rejects.toMatchObject({ code: "session_required" });
  }
  const otherToken = randomUUID();
  await sql`INSERT INTO public.landing_sessions (school_id, session_key_hash)
    VALUES (${otherSchoolId}, ${hashToken(otherToken)})`;
  await expect(
    createLead({ ...input, contact, source: { channel: "web", landingSessionToken: otherToken } }),
  ).rejects.toMatchObject({ code: "session_required" });
  await expect(
    createLead({ ...input, contact, offeringId: otherOfferingId }),
  ).rejects.toMatchObject({ code: "23503" });
  expect(await sql`SELECT id FROM public.contacts WHERE email = ${contact.email}`).toHaveLength(0);
});

it("is an invoker with an empty search path executable only by service_role", async () => {
  const [routine] = await sql`SELECT p.prosecdef, p.proconfig,
    has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
    has_function_privilege('service_role', p.oid, 'EXECUTE') AS service
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'create_lead'`;
  expect(routine).toMatchObject({
    prosecdef: false,
    proconfig: ['search_path=""'],
    anon: false,
    authenticated: false,
    service: true,
  });
  for (const role of ["anon", "authenticated"]) {
    await expect(
      sql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE ${role}`);
        await tx`SELECT public.create_lead(${schoolId}, 'Denied', 'denied', 'web', ${hashToken(token)})`;
      }),
    ).rejects.toMatchObject({ code: "42501" });
  }
});

it("composes in another SQL function and rolls all effects back with its outer transaction", async () => {
  const hash = randomUUID();
  let leadId = "";
  await expect(
    sql.begin(async (tx) => {
      await tx`CREATE FUNCTION pg_temp.test_lead(p_school uuid, p_hash text) RETURNS uuid
      LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
      SELECT (public.create_lead(p_school, 'Rollback', 'rollback-phone', 'whatsapp', p_hash)).id $$`;
      const [lead] = await tx`SELECT pg_temp.test_lead(${schoolId}, ${hash}) AS id`;
      leadId = requireRow(lead, "composed lead").id;
      expect(
        await tx`SELECT id FROM public.email_deliveries WHERE lead_id = ${lead!.id}`,
      ).toHaveLength(1);
      expect(
        await tx`SELECT id FROM public.funnel_events WHERE lead_id = ${lead!.id}`,
      ).toHaveLength(1);
      throw new Error("outer rollback");
    }),
  ).rejects.toThrow("outer rollback");
  expect(await sql`SELECT id FROM public.contacts WHERE phone = 'rollback-phone'`).toHaveLength(0);
  expect(
    await sql`SELECT id FROM public.landing_sessions WHERE session_key_hash = ${hash}`,
  ).toHaveLength(0);
  expect(await sql`SELECT id FROM public.leads WHERE id = ${leadId}`).toHaveLength(0);
  expect(await sql`SELECT id FROM public.email_deliveries WHERE lead_id = ${leadId}`).toHaveLength(
    0,
  );
  expect(await sql`SELECT id FROM public.funnel_events WHERE lead_id = ${leadId}`).toHaveLength(0);
});

it("counts queued owner emails against the unchanged 12-per-day recipient limit", async () => {
  expect(await ownerLeadQuotaExceeded(schoolId)).toBe(false);
  const [row] =
    await sql`SELECT count(*)::integer AS count FROM public.email_deliveries WHERE school_id = ${schoolId}`;
  for (let count = row!.count; count < 12; count++) await createLead(input);
  expect(await ownerLeadQuotaExceeded(schoolId)).toBe(true);
});
