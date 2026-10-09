import { createHmac, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { POST } from "@/app/api/webhooks/resend/route";
import { getDb } from "@/db";
import { emailDeliveries } from "@/db/schema";
import { recordResendDeliveryEvent } from "@/lib/email/delivery-event";
import { authSql, loadLocalEnv } from "@/test/integration-env";
import { deleteSchoolOwner, seedSchool } from "@/test/seed-school";

loadLocalEnv();
const db = getDb();
const sql = authSql();
const ownerId = randomUUID();
let schoolId = "";

beforeAll(async () => {
  ({ schoolId } = await seedSchool(sql, {
    ownerId,
    slug: `delivery-${randomUUID()}`,
    name: "Delivery School",
    offerings: [{ name: "Trial" }],
  }));
});

afterAll(async () => {
  await deleteSchoolOwner(sql, ownerId);
  await sql.end({ timeout: 5 });
});

afterEach(() => vi.unstubAllEnvs());

describe("recordResendDeliveryEvent", () => {
  it("records a delivered event only on the matching provider delivery", async () => {
    const providerId = randomUUID();
    const otherProviderId = randomUUID();
    await db.insert(emailDeliveries).values(
      [providerId, otherProviderId].map((id) => ({
        schoolId,
        kind: "owner_lead" as const,
        recipient: "delivered@resend.dev",
        providerIdempotencyKey: randomUUID(),
        providerId: id,
        state: "sent" as const,
        updatedAt: new Date("2025-01-01T00:00:00Z"),
      })),
    );
    expect(
      await recordResendDeliveryEvent({
        type: "email.delivered",
        data: { email_id: providerId },
      }),
    ).toEqual({ status: "recorded" });
    const rows = await db
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.schoolId, schoolId));
    expect(rows.find((row) => row.providerId === providerId)?.state).toBe(
      "delivered",
    );
    expect(
      rows.find((row) => row.providerId === providerId)?.updatedAt.getTime(),
    ).toBeGreaterThan(new Date("2025-01-01T00:00:00Z").getTime());
    expect(rows.find((row) => row.providerId === otherProviderId)?.state).toBe(
      "sent",
    );
  });

  it.each([
    ["email.bounced", "bounced"],
    ["email.complained", "complained"],
  ])("records %s and accepts provider retries", async (type, state) => {
    const providerId = randomUUID();
    await db.insert(emailDeliveries).values({
      schoolId,
      kind: "owner_lead",
      recipient: "delivered@resend.dev",
      providerIdempotencyKey: randomUUID(),
      providerId,
      state: "sent",
    });
    for (let retry = 0; retry < 2; retry++) {
      expect(
        await recordResendDeliveryEvent({
          type,
          data: { email_id: providerId },
        }),
      ).toEqual({ status: "recorded" });
    }
    const rows = await db
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.providerId, providerId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe(state);
  });

  it("ignores unrelated or missing-id events without changing any delivery", async () => {
    const providerId = randomUUID();
    await db.insert(emailDeliveries).values({
      schoolId,
      kind: "owner_lead",
      recipient: "delivered@resend.dev",
      providerIdempotencyKey: randomUUID(),
      providerId,
      state: "sent",
    });
    const before = await db
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.schoolId, schoolId));
    for (const event of [
      { type: "email.opened", data: { email_id: providerId } },
      { type: "future.event", data: { email_id: providerId } },
      { type: "email.delivered", data: {} },
      { type: "email.delivered", data: { email_id: "" } },
      { type: "email.delivered" },
    ]) {
      expect(await recordResendDeliveryEvent(event)).toEqual({
        status: "ignored",
      });
    }
    expect(
      await recordResendDeliveryEvent({
        type: "email.delivered",
        data: { email_id: randomUUID() },
      }),
    ).toEqual({ status: "recorded" });
    expect(
      await db
        .select()
        .from(emailDeliveries)
        .where(eq(emailDeliveries.schoolId, schoolId)),
    ).toEqual(before);
  });
});

describe("Resend HTTP adapter", () => {
  const signingKey = Buffer.from("local-only-resend-webhook-signing-key");
  const secret = `whsec_${signingKey.toString("base64")}`;

  function signedRequest(payload: string) {
    const id = randomUUID();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", signingKey)
      .update(`${id}.${timestamp}.${payload}`)
      .digest("base64");
    return new Request("http://localhost/api/webhooks/resend", {
      method: "POST",
      body: payload,
      headers: {
        "svix-id": id,
        "svix-timestamp": timestamp,
        "svix-signature": `v1,${signature}`,
      },
    });
  }

  async function expectResponse(
    request: Request,
    status: number,
    body: unknown,
  ) {
    const response = await POST(request);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(body);
  }

  it("keeps missing configuration ahead of body-size and signature checks", async () => {
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "");
    await expectResponse(signedRequest("x".repeat(64_001)), 500, {
      error: "unconfigured",
    });
  });

  it("rejects an oversized raw body in bytes", async () => {
    vi.stubEnv("RESEND_WEBHOOK_SECRET", secret);
    await expectResponse(signedRequest("é".repeat(32_001)), 413, {
      error: "too_large",
    });
  });

  it("keeps invalid and missing signatures at 401", async () => {
    vi.stubEnv("RESEND_WEBHOOK_SECRET", secret);
    vi.stubEnv("RESEND_API_KEY", "re_local_test_only");
    const invalid = signedRequest('{"type":"email.delivered"}');
    invalid.headers.set("svix-signature", "v1,invalid");
    await expectResponse(invalid, 401, { error: "invalid_signature" });
    await expectResponse(
      new Request("http://localhost/api/webhooks/resend", {
        method: "POST",
        body: "{}",
      }),
      401,
      { error: "invalid_signature" },
    );
  });

  it("verifies the raw signature and records a delivery before acknowledging", async () => {
    vi.stubEnv("RESEND_WEBHOOK_SECRET", secret);
    vi.stubEnv("RESEND_API_KEY", "re_local_test_only");
    const providerId = randomUUID();
    await db.insert(emailDeliveries).values({
      schoolId,
      kind: "owner_lead",
      recipient: "delivered@resend.dev",
      providerIdempotencyKey: randomUUID(),
      providerId,
      state: "sent",
    });
    const payload = JSON.stringify(
      { type: "email.delivered", data: { email_id: providerId } },
      null,
      2,
    );
    await expectResponse(signedRequest(payload), 200, { ok: true });
    const [row] = await db
      .select()
      .from(emailDeliveries)
      .where(eq(emailDeliveries.providerId, providerId));
    expect(row?.state).toBe("delivered");
  });

  it.each([
    { type: "email.delivered", data: { email_id: randomUUID() } },
    { type: "email.delivered", data: {} },
    { type: "email.opened", data: { email_id: randomUUID() } },
    { type: "future.event" },
  ])("acknowledges unknown and ignored signed inputs: %j", async (event) => {
    vi.stubEnv("RESEND_WEBHOOK_SECRET", secret);
    vi.stubEnv("RESEND_API_KEY", "re_local_test_only");
    await expectResponse(signedRequest(JSON.stringify(event)), 200, {
      ok: true,
    });
  });
});
