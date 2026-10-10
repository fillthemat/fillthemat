import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { eq, inArray } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { getDb } from "@/db";
import { schools, whatsappDeliveries } from "@/db/schema";
import { authSql, loadLocalEnv } from "@/test/integration-env";
import { deleteSchoolOwner, seedSchool } from "@/test/seed-school";
import { scopedWhatsAppRunner } from "@/test/whatsapp-worker";
import type { WhatsAppSendFailure, WhatsAppSendOutcome } from "./client";
import { applyWhatsAppStatuses, enqueueWhatsAppDelivery } from "./deliveries";

loadLocalEnv();
const db = getDb();
const sql = authSql();
const ownerId = randomUUID();
const suffix = randomUUID();
const phoneNumberId = `delivery-retry-${suffix}`;
const { runWhatsAppWorkerOnce, drainDueWhatsAppDeliveries } =
  scopedWhatsAppRunner(() => [phoneNumberId]);
const initialNow = new Date("2019-01-01T12:00:00Z");
let now = initialNow;
let schoolId: string;
const ids: string[] = [];

beforeAll(async () => {
  const seeded = await seedSchool(sql, {
    ownerId,
    name: "Delivery Retry School",
    slug: `dr-${suffix}`,
    whatsappPhoneNumberId: phoneNumberId,
    offerings: [{ name: "BJJ" }],
  });
  schoolId = seeded.schoolId;
});
afterEach(async () => {
  if (ids.length)
    await db
      .delete(whatsappDeliveries)
      .where(inArray(whatsappDeliveries.id, ids));
  ids.length = 0;
  now = initialNow;
  await db
    .update(schools)
    .set({ approvedAt: new Date() })
    .where(eq(schools.id, schoolId));
  vi.restoreAllMocks();
});
afterAll(async () => {
  await deleteSchoolOwner(sql, ownerId);
  await sql.end({ timeout: 5 });
});

async function enqueue(
  overrides: Partial<typeof whatsappDeliveries.$inferInsert> = {},
) {
  const id = await enqueueWhatsAppDelivery(
    {
      schoolId,
      phoneNumberId,
      recipientWaId: "16505550082",
      body: "Private message",
      providerIdempotencyKey: `delivery-retry/${randomUUID()}`,
      windowExpiresAt: new Date("2019-01-02T12:00:00Z"),
    },
    now,
  );
  if (!id) throw new Error("test enqueue failed");
  ids.push(id);
  if (Object.keys(overrides).length)
    await db
      .update(whatsappDeliveries)
      .set(overrides)
      .where(eq(whatsappDeliveries.id, id));
  return id;
}
async function delivery(id: string) {
  const [row] = await db
    .select()
    .from(whatsappDeliveries)
    .where(eq(whatsappDeliveries.id, id));
  return row;
}
function dependencies(send: () => Promise<WhatsAppSendOutcome>) {
  return {
    now: () => new Date(now),
    sleep: async () => {
      throw new Error("unexpected retry loop");
    },
    transport: { sendText: send, sendTemplate: send, sendInteractive: send },
  };
}

describe("bounded WhatsApp delivery executions through the worker", () => {
  it("keeps a recovered fifth execution dead when the old sender finally reports acceptance", async () => {
    const id = await enqueue({ attempts: 4 });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let finish!: () => void;
    const paused = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const oldRun = runWhatsAppWorkerOnce(
      randomUUID(),
      dependencies(async () => {
        entered();
        await paused;
        return { ok: true, kind: "accepted", providerId: "fake:late" };
      }),
    );
    await started;
    try {
      now = new Date("2019-01-01T12:06:00Z");
      const send = vi.fn(
        async (): Promise<WhatsAppSendOutcome> => ({
          ok: true,
          kind: "accepted",
          providerId: "must-not-send",
        }),
      );
      const recovered = await runWhatsAppWorkerOnce(
        randomUUID(),
        dependencies(send),
      );
      expect(recovered.deliveries).toMatchObject({ claimed: 0, dead: 1 });
      expect(send).not.toHaveBeenCalled();
    } finally {
      finish();
    }
    expect((await oldRun).deliveries.deferred).toBe(1);
    expect(await delivery(id)).toMatchObject({
      state: "dead",
      attempts: 5,
      terminalCause: "attempts_exhausted",
      providerId: null,
    });
    expect(log).toHaveBeenCalledTimes(1);
  });
  it("backfills legacy accepted failures to at least one execution without changing other states or reducing counts", async () => {
    const statements = readdirSync("drizzle")
      .filter((name) => name.endsWith(".sql"))
      .flatMap((name) =>
        readFileSync(`drizzle/${name}`, "utf8").split(
          "--> statement-breakpoint",
        ),
      );
    const backfill = statements.find((statement) =>
      statement.includes("Legacy accepted sends"),
    );
    expect(backfill).toBeDefined();
    if (!backfill) throw new Error("missing legacy delivery backfill");
    await sql.begin(async (tx) => {
      await tx`CREATE TEMP TABLE wa_backfill (id text, state app.whatsapp_delivery_state, attempts integer, provider_id text) ON COMMIT DROP`;
      await tx`INSERT INTO wa_backfill VALUES
        ('accepted_failure', 'failed', 0, 'legacy:accepted'),
        ('counted_failure', 'failed', 3, 'legacy:counted'),
        ('exhausted_failure', 'failed', 5, 'legacy:exhausted'),
        ('unsent_failure', 'failed', 0, NULL),
        ('fresh', 'pending', 0, 'legacy:pending'),
        ('accepted', 'sent', 0, 'legacy:sent'),
        ('delivered', 'delivered', 0, 'legacy:delivered'),
        ('read', 'read', 0, 'legacy:read')`;
      await tx.unsafe(
        backfill.replaceAll(
          '"app"."whatsapp_deliveries"',
          'pg_temp."wa_backfill"',
        ),
      );
      const rows = await tx`SELECT id, attempts FROM wa_backfill ORDER BY id`;
      expect(rows.map((row) => [row.id, row.attempts])).toEqual([
        ["accepted", 0],
        ["accepted_failure", 1],
        ["counted_failure", 3],
        ["delivered", 0],
        ["exhausted_failure", 5],
        ["fresh", 0],
        ["read", 0],
        ["unsent_failure", 0],
      ]);
    });
  });
  it.each(["accepted", "permanent", "network", "thrown"])(
    "fences a stale sender's %s finalization even with a reused run ID",
    async (outcome) => {
      const id = await enqueue();
      let entered!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      let finish!: () => void;
      const paused = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const runId = randomUUID();
      const oldRun = runWhatsAppWorkerOnce(
        runId,
        dependencies(async () => {
          entered();
          await paused;
          if (outcome === "thrown") throw new Error("old private exception");
          if (outcome === "network")
            return { ok: false, kind: "network_error", message: "old failure" };
          if (outcome === "permanent")
            return {
              ok: false,
              kind: "whatsapp_error",
              code: 190,
              subcode: null,
              details: null,
              status: 401,
              message: "old failure",
            };
          return { ok: true, kind: "accepted", providerId: "fake:old" };
        }),
      );
      await started;
      try {
        expect(await delivery(id)).toMatchObject({
          state: "claimed",
          attempts: 1,
        });
        now = new Date("2019-01-01T12:06:00Z");
        const reclaimed = await runWhatsAppWorkerOnce(
          runId,
          dependencies(async () => ({
            ok: true,
            kind: "accepted",
            providerId: "fake:new",
          })),
        );
        expect(reclaimed.deliveries.sent).toBe(1);
      } finally {
        finish();
      }
      expect((await oldRun).deliveries).toMatchObject({
        sent: 0,
        retrying: 0,
        dead: 0,
        deferred: 1,
      });
      expect(await delivery(id)).toMatchObject({
        state: "sent",
        providerId: "fake:new",
        attempts: 2,
        lastError: null,
        claimedAt: null,
        claimedBy: null,
      });
      expect(log).not.toHaveBeenCalled();
    },
  );
  it("ignores every callback for a dead delivery instead of reopening it", async () => {
    const id = await enqueue({
      state: "dead",
      attempts: 5,
      providerId: `fake:dead/${suffix}`,
      failureReason: "network_error",
      terminalCause: "attempts_exhausted",
    });
    for (const status of ["failed", "sent", "delivered", "read"] as const) {
      await applyWhatsAppStatuses([
        {
          wamid: `fake:dead/${suffix}`,
          status,
          timestamp: initialNow.getTime() / 1000 + 1,
          recipientId: null,
          errorCode: "131016",
          errorMessage: "late failure",
        },
      ]);
      expect(await delivery(id)).toMatchObject({
        state: "dead",
        attempts: 5,
        terminalCause: "attempts_exhausted",
      });
    }
  });
  it.each([
    131047, 131026, 190, 250, 100, 132001, 132015, 368, 130403, 131050, 131049,
  ])(
    "stops permanent Meta class %i after one execution and logs only structured fields",
    async (code) => {
      const id = await enqueue();
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const send = vi.fn(
        async (): Promise<WhatsAppSendOutcome> => ({
          ok: false,
          kind: "whatsapp_error",
          code,
          subcode: 123,
          details: "Private details",
          status: 400,
          message: "Private provider error",
        }),
      );
      const result = await runWhatsAppWorkerOnce(
        randomUUID(),
        dependencies(send),
      );
      expect(await delivery(id)).toMatchObject({
        state: "dead",
        attempts: 1,
        failureReason: "whatsapp_error",
        failureCode: code,
        terminalCause: "permanent",
        lastError: `${code}: Private provider error`,
        claimedBy: null,
        claimedAt: null,
      });
      expect(result.deliveries.dead).toBe(1);
      await runWhatsAppWorkerOnce(randomUUID(), dependencies(send));
      expect(send).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledTimes(1);
      expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({
        code,
        executions: 1,
      });
      expect(log.mock.calls[0][0]).not.toContain("Private");
    },
  );
  it("stops the structured missing-credentials outcome instead of retrying configuration", async () => {
    const id = await enqueue();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await runWhatsAppWorkerOnce(
      randomUUID(),
      dependencies(async () => ({
        ok: false,
        kind: "missing_credentials",
        message: "Token missing",
      })),
    );
    expect(await delivery(id)).toMatchObject({
      state: "dead",
      terminalCause: "permanent",
      failureReason: "missing_credentials",
    });
    expect(log).toHaveBeenCalledTimes(1);
  });
  it.each([
    {
      ok: false,
      kind: "whatsapp_error",
      code: 130429,
      subcode: null,
      details: null,
      status: 429,
      message: "rate limit",
    },
    {
      ok: false,
      kind: "whatsapp_error",
      code: 131016,
      subcode: null,
      details: null,
      status: 503,
      message: "unavailable",
    },
    {
      ok: false,
      kind: "whatsapp_error",
      code: 999999,
      subcode: null,
      details: null,
      status: 400,
      message: "unknown",
    },
    {
      ok: false,
      kind: "whatsapp_error",
      code: null,
      subcode: 190,
      details: null,
      status: 400,
      message: "no code",
    },
    { ok: false, kind: "network_error", message: "network" },
    { ok: false, kind: "http_error", status: 503, message: "http" },
    {
      ok: false,
      kind: "malformed_response",
      status: 200,
      message: "missing id",
    },
  ] satisfies WhatsAppSendFailure[])(
    "shares five executions across claim batches for $kind $message",
    async (outcome) => {
      const id = await enqueue();
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const send = vi.fn(async (): Promise<WhatsAppSendOutcome> => outcome);
      const due = [
        "2019-01-01T12:00:10Z",
        "2019-01-01T12:00:30Z",
        "2019-01-01T12:01:10Z",
        "2019-01-01T12:02:30Z",
      ];
      for (let execution = 1; execution <= 5; execution++) {
        const result = await drainDueWhatsAppDeliveries(
          randomUUID(),
          25,
          dependencies(send),
        );
        const row = await delivery(id);
        expect(row).toMatchObject({
          state: execution === 5 ? "dead" : "failed",
          attempts: execution,
          failureReason: outcome.kind,
          terminalCause: execution === 5 ? "attempts_exhausted" : null,
          claimedAt: null,
          claimedBy: null,
        });
        expect(result[execution === 5 ? "dead" : "retrying"]).toBe(1);
        if (execution < 5) {
          expect(row.nextAttemptAt).toEqual(new Date(due[execution - 1]));
          expect(
            (
              await drainDueWhatsAppDeliveries(
                randomUUID(),
                25,
                dependencies(send),
              )
            ).claimed,
          ).toBe(0);
          now = row.nextAttemptAt;
        }
      }
      now = new Date(now.getTime() + 100_000);
      await runWhatsAppWorkerOnce(randomUUID(), dependencies(send));
      expect(send).toHaveBeenCalledTimes(5);
      expect(log).toHaveBeenCalledTimes(1);
    },
  );
  it.each([0, 3, 5])(
    "recovers crashed execution count %i without restoring the budget",
    async (attempts) => {
      const id = await enqueue({
        state: "claimed",
        attempts,
        claimedAt: new Date("2019-01-01T11:54:00Z"),
        claimedBy: "crashed",
        nextAttemptAt: new Date("2019-01-01T13:00:00Z"),
        lastError: "prior diagnostic",
        failureReason: "network_error",
      });
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const send = vi.fn(
        async (): Promise<WhatsAppSendOutcome> => ({
          ok: true,
          kind: "accepted",
          providerId: "must-not-send",
        }),
      );
      const result = await runWhatsAppWorkerOnce(
        randomUUID(),
        dependencies(send),
      );
      expect(await delivery(id)).toMatchObject({
        state: attempts === 5 ? "dead" : "pending",
        attempts,
        lastError: "prior diagnostic",
        failureReason: "network_error",
        claimedAt: null,
        claimedBy: null,
        terminalCause: attempts === 5 ? "attempts_exhausted" : null,
      });
      expect(send).not.toHaveBeenCalled();
      expect(result.deliveries.dead).toBe(attempts === 5 ? 1 : 0);
      await runWhatsAppWorkerOnce(randomUUID(), dependencies(send));
      expect(log).toHaveBeenCalledTimes(attempts === 5 ? 1 : 0);
    },
  );
  it.each(["accepted", "local_noop"] as const)(
    "persists the fifth execution before %s and does not resend it",
    async (kind) => {
      const id = await enqueue({ attempts: 4, state: "failed" });
      const send = vi.fn(async (): Promise<WhatsAppSendOutcome> => {
        expect(await delivery(id)).toMatchObject({
          state: "claimed",
          attempts: 5,
        });
        return kind === "accepted"
          ? { ok: true, kind, providerId: "fake:accepted" }
          : { ok: true, kind, providerId: null };
      });
      const result = await runWhatsAppWorkerOnce(
        randomUUID(),
        dependencies(send),
      );
      expect(result.deliveries.sent).toBe(1);
      expect(await delivery(id)).toMatchObject({
        state: "sent",
        attempts: 5,
        claimedAt: null,
        claimedBy: null,
        providerId: kind === "accepted" ? "fake:accepted" : `local-noop:${id}`,
      });
      now = new Date(now.getTime() + 100_000);
      await runWhatsAppWorkerOnce(randomUUID(), dependencies(send));
      expect(send).toHaveBeenCalledTimes(1);
    },
  );
  it("never starts execution six for an already-exhausted legacy delivery", async () => {
    const id = await enqueue({
      state: "failed",
      attempts: 5,
      lastError: "legacy diagnostic",
      failureReason: "whatsapp_error",
      failureCode: 131016,
    });
    const send = vi.fn(
      async (): Promise<WhatsAppSendOutcome> => ({
        ok: true,
        kind: "accepted",
        providerId: "must-not-send",
      }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runWhatsAppWorkerOnce(
      randomUUID(),
      dependencies(send),
    );
    expect(send).not.toHaveBeenCalled();
    expect(await delivery(id)).toMatchObject({
      state: "dead",
      attempts: 5,
      terminalCause: "attempts_exhausted",
      lastError: "legacy diagnostic",
      failureReason: "whatsapp_error",
      failureCode: 131016,
    });
    expect(result.deliveries.dead).toBe(1);
  });
  it.each([
    "school_not_approved",
    "text_window_closed",
    "interactive_window_closed",
  ])(
    "stops %s without an outbound execution or transport request",
    async (reason) => {
      const id = await enqueue(
        reason === "school_not_approved"
          ? {}
          : {
              windowExpiresAt: now,
              interactiveButtons:
                reason === "interactive_window_closed"
                  ? [{ id: "confirm", title: "Confirm" }]
                  : null,
            },
      );
      if (reason === "school_not_approved")
        await db
          .update(schools)
          .set({ approvedAt: null })
          .where(eq(schools.id, schoolId));
      const send = vi.fn(
        async (): Promise<WhatsAppSendOutcome> => ({
          ok: true,
          kind: "accepted",
          providerId: "must-not-send",
        }),
      );
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const runId = randomUUID();
      const result = await runWhatsAppWorkerOnce(runId, dependencies(send));
      expect(send).not.toHaveBeenCalled();
      expect(await delivery(id)).toMatchObject({
        state: "dead",
        attempts: 0,
        terminalCause: "permanent",
        failureReason:
          reason === "school_not_approved" ? reason : "window_closed",
        claimedAt: null,
        claimedBy: null,
        body: "Private message",
      });
      expect(result.deliveries).toEqual({
        claimed: 1,
        sent: 0,
        retrying: 0,
        dead: 1,
        deferred: 0,
      });
      expect(
        (await runWhatsAppWorkerOnce(randomUUID(), dependencies(send)))
          .deliveries.claimed,
      ).toBe(0);
      expect(log).toHaveBeenCalledTimes(1);
      const event = JSON.parse(log.mock.calls[0][0]);
      expect(event).toMatchObject({
        event: "queue.dead",
        queue: "whatsapp_delivery",
        id,
        schoolId,
        executions: 0,
        runId,
      });
      expect(log.mock.calls[0][0]).not.toContain("Private message");
      expect(log.mock.calls[0][0]).not.toContain("16505550082");
    },
  );
});
