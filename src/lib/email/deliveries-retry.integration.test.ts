import { randomUUID } from "node:crypto";
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
import { getDb } from "@/db";
import {
  contacts,
  emailDeliveries,
  landingSessions,
  leads,
  schools,
} from "@/db/schema";
import { authSql, loadLocalEnv, requireRow } from "@/test/integration-env";
import { deleteSchoolOwner, seedSchool } from "@/test/seed-school";
import {
  attemptPendingForLead,
  runEmailSendOnce,
  sendDelivery,
} from "./deliveries";
import { recordResendDeliveryEvent } from "./delivery-event";

loadLocalEnv();
const db = getDb();
const sql = authSql();
const ownerId = randomUUID();
let schoolId = "";
let leadId = "";
const now = new Date("2020-01-01T00:00:00Z");
beforeAll(async () => {
  ({ schoolId } = await seedSchool(sql, {
    ownerId,
    name: "Email Retry School",
    slug: `email-retry-${ownerId}`,
    offerings: [{ name: "Trial" }],
  }));
  const [contact] = await db
    .insert(contacts)
    .values({ schoolId, name: "Contact", phone: ownerId })
    .returning();
  const [session] = await db
    .insert(landingSessions)
    .values({ schoolId, sessionKeyHash: ownerId })
    .returning();
  const [lead] = await db
    .insert(leads)
    .values({
      schoolId,
      contactId: requireRow(contact, "contact").id,
      landingSessionId: requireRow(session, "session").id,
    })
    .returning();
  leadId = requireRow(lead, "lead").id;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await db
    .delete(emailDeliveries)
    .where(eq(emailDeliveries.schoolId, schoolId));
});
afterAll(async () => {
  await deleteSchoolOwner(sql, ownerId);
  await sql.end({ timeout: 5 });
});
async function enqueue(
  extra: Partial<typeof emailDeliveries.$inferInsert> = {},
) {
  const [row] = await db
    .insert(emailDeliveries)
    .values({
      schoolId,
      leadId,
      kind: "owner_lead",
      recipient: "delivered@resend.dev",
      providerIdempotencyKey: randomUUID(),
      nextAttemptAt: now,
      createdAt: now,
      ...extra,
    })
    .returning();
  return requireRow(row, "email");
}
async function stored(id: string) {
  const [row] = await db
    .select()
    .from(emailDeliveries)
    .where(eq(emailDeliveries.id, id));
  return requireRow(row, "stored email");
}
describe("bounded email send run", () => {
  it("concurrent runs never send the same claimed email twice", async () => {
    const rows = [];
    for (let index = 0; index < 10; index++) rows.push(await enqueue());
    const sent: string[] = [];
    const dependencies = {
      now: () => now,
      transport: {
        send: async (message: { idempotencyKey: string }) => {
          sent.push(message.idempotencyKey);
          return {
            ok: true as const,
            kind: "accepted" as const,
            providerId: randomUUID(),
          };
        },
      },
    };
    const options = { ids: rows.map((row) => row.id), limit: 5 };
    const counts = await Promise.all([
      runEmailSendOnce("concurrent-one", dependencies, options),
      runEmailSendOnce("concurrent-two", dependencies, options),
    ]);
    expect(counts.map((count) => count.sent)).toEqual([5, 5]);
    expect(sent).toHaveLength(10);
    expect(new Set(sent).size).toBe(10);
  });
  it("allows a fifth success but rejects an unapproved School before contacting the provider", async () => {
    const fifth = await enqueue({ attempts: 4 });
    const sends: string[] = [];
    const dependencies = {
      now: () => now,
      transport: {
        send: async (message: { idempotencyKey: string }) => {
          sends.push(message.idempotencyKey);
          return {
            ok: true as const,
            kind: "accepted" as const,
            providerId: randomUUID(),
          };
        },
      },
    };
    await runEmailSendOnce("fifth-success", dependencies, { ids: [fifth.id] });
    expect(await stored(fifth.id)).toMatchObject({
      state: "sent",
      attempts: 5,
    });
    const blocked = await enqueue();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await db
      .update(schools)
      .set({ approvedAt: null })
      .where(eq(schools.id, schoolId));
    try {
      expect(
        await runEmailSendOnce("unapproved", dependencies, {
          ids: [blocked.id],
        }),
      ).toMatchObject({ dead: 1 });
      expect(await stored(blocked.id)).toMatchObject({
        state: "dead",
        attempts: 1,
        failureReason: "school_not_approved",
        terminalCause: "permanent",
      });
      expect(sends).toEqual([fifth.providerIdempotencyKey]);
    } finally {
      await db
        .update(schools)
        .set({ approvedAt: now })
        .where(eq(schools.id, schoolId));
    }
  });
  it.each([0, 1])(
    "refills an empty lane (executions=%i), excludes future and dead rows, and orders timestamp ties by ID",
    async (attempts) => {
      const rows = [];
      for (let index = 30; index > 0; index--)
        rows.push(
          await enqueue({
            attempts,
            id: `${ownerId.slice(0, 8)}-${ownerId.slice(9, 13)}-4000-8000-${String(index).padStart(12, "0")}`,
          }),
        );
      const future = await enqueue({
        nextAttemptAt: new Date(now.getTime() + 1),
      });
      const dead = await enqueue({ state: "dead" });
      const sent: string[] = [];
      await runEmailSendOnce(
        "refill",
        {
          now: () => now,
          transport: {
            send: async (message) => {
              sent.push(message.idempotencyKey);
              return { ok: true, kind: "accepted", providerId: randomUUID() };
            },
          },
        },
        { ids: [...rows, future, dead].map((row) => row.id) },
      );
      expect(sent).toEqual(
        rows
          .slice()
          .reverse()
          .slice(0, 25)
          .map((row) => row.providerIdempotencyKey),
      );
      expect((await stored(future.id)).attempts).toBe(0);
      expect((await stored(dead.id)).state).toBe("dead");
    },
  );
  it.each(["accepted", "rejected"])(
    "fences %s results from a recovered old sender",
    async (outcome) => {
      const row = await enqueue();
      let release: (() => void) | undefined;
      let entered: (() => void) | undefined;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const waiting = new Promise<void>((resolve) => {
        release = resolve;
      });
      const old = runEmailSendOnce(
        "same-owner",
        {
          now: () => now,
          transport: {
            send: async () => {
              entered?.();
              await waiting;
              if (outcome === "accepted")
                return {
                  ok: true,
                  kind: "accepted",
                  providerId: "old-provider",
                };
              return {
                ok: false,
                kind: "email_error",
                name: "validation_error",
                status: 422,
                message: "old rejection",
              };
            },
          },
        },
        { ids: [row.id] },
      );
      await started;
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        await runEmailSendOnce(
          "same-owner",
          {
            now: () => new Date(now.getTime() + 6 * 60_000),
            transport: {
              send: async () => ({
                ok: true,
                kind: "accepted",
                providerId: "new-provider",
              }),
            },
          },
          { ids: [row.id] },
        );
      } finally {
        release?.();
      }
      expect(await old).toMatchObject({ deferred: 1, dead: 0 });
      expect(await stored(row.id)).toMatchObject({
        state: "sent",
        attempts: 2,
        providerId: "new-provider",
        lastError: null,
      });
      expect(log).not.toHaveBeenCalled();
    },
  );
  it("returns refilled fresh work before a partially filled retry lane", async () => {
    const fresh = [];
    for (let index = 0; index < 30; index++)
      fresh.push(await enqueue({ createdAt: new Date(now.getTime() + index) }));
    const retry = await enqueue({ attempts: 1 });
    const sent: string[] = [];
    await runEmailSendOnce(
      "partial-refill",
      {
        now: () => now,
        transport: {
          send: async (message) => {
            sent.push(message.idempotencyKey);
            return { ok: true, kind: "accepted", providerId: randomUUID() };
          },
        },
      },
      { ids: [...fresh, retry].map((row) => row.id) },
    );
    expect(sent).toEqual(
      [...fresh.slice(0, 24), retry].map((row) => row.providerIdempotencyKey),
    );
  });
  it("inline lead and ID sends obey due times and never start a sixth execution", async () => {
    const row = await enqueue({ attempts: 5, state: "failed" });
    const future = await enqueue({
      nextAttemptAt: new Date(now.getTime() + 60_000),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    let sends = 0;
    const dependencies = {
      now: () => now,
      transport: {
        send: async () => {
          sends++;
          return {
            ok: true as const,
            kind: "accepted" as const,
            providerId: "unexpected",
          };
        },
      },
    };
    await attemptPendingForLead(leadId, dependencies);
    await sendDelivery(row.id, dependencies);
    await sendDelivery(future.id, dependencies);
    expect(sends).toBe(0);
    expect(await stored(row.id)).toMatchObject({ state: "dead", attempts: 5 });
    expect(await stored(future.id)).toMatchObject({
      state: "pending",
      attempts: 0,
    });
  });
  it("provider delivery events cannot reopen a dead email", async () => {
    const row = await enqueue({
      state: "dead",
      providerId: randomUUID(),
      attempts: 5,
    });
    for (const type of ["email.delivered", "email.bounced", "email.complained"])
      await recordResendDeliveryEvent({
        type,
        data: { email_id: row.providerId },
      });
    expect((await stored(row.id)).state).toBe("dead");
  });
  it("reserves 20 fresh and 5 retry slots and sends oldest first within each lane", async () => {
    const retry = [];
    const fresh = [];
    for (let index = 0; index < 30; index++) {
      retry.push(
        await enqueue({
          attempts: 1,
          state: "failed",
          createdAt: new Date(now.getTime() - 60_000 + index),
        }),
      );
      fresh.push(
        await enqueue({ createdAt: new Date(now.getTime() - 30_000 + index) }),
      );
    }
    const sent: string[] = [];
    const counts = await runEmailSendOnce(
      "lanes",
      {
        now: () => now,
        transport: {
          send: async (message) => {
            sent.push(message.idempotencyKey);
            return { ok: true, kind: "accepted", providerId: randomUUID() };
          },
        },
      },
      { ids: [...fresh, ...retry].map((row) => row.id) },
    );
    expect(counts).toMatchObject({ claimed: 25, sent: 25 });
    expect(sent).toEqual(
      [...fresh.slice(0, 20), ...retry.slice(0, 5)].map(
        (row) => row.providerIdempotencyKey,
      ),
    );
  });
  it("preserves minute backoff across runs and stops transient sends at five", async () => {
    const row = await enqueue();
    vi.spyOn(console, "error").mockImplementation(() => {});
    let time = now;
    let sends = 0;
    const dependencies = {
      now: () => time,
      transport: {
        send: async () => {
          sends++;
          return {
            ok: false as const,
            kind: "email_error" as const,
            name: "rate_limit_exceeded",
            status: 429,
            message: "retry later",
          };
        },
      },
    };
    for (const delay of [60_000, 120_000, 240_000, 480_000]) {
      expect(await runEmailSendOnce(randomUUID(), dependencies)).toMatchObject({
        retrying: 1,
        dead: 0,
      });
      const storedRow = await stored(row.id);
      expect(storedRow.nextAttemptAt.getTime()).toBe(time.getTime() + delay);
      expect(await runEmailSendOnce(randomUUID(), dependencies)).toMatchObject({
        claimed: 0,
      });
      time = storedRow.nextAttemptAt;
    }
    expect(await runEmailSendOnce("fifth", dependencies)).toMatchObject({
      dead: 1,
    });
    expect(await stored(row.id)).toMatchObject({
      attempts: 5,
      state: "dead",
      terminalCause: "attempts_exhausted",
    });
    await runEmailSendOnce("sixth", dependencies);
    expect(sends).toBe(5);
  });
  it("recovers a stale claim without resetting executions and dies on a fifth crash", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const staleAt = new Date(now.getTime() - 6 * 60_000);
    const exhausted = await enqueue({
      state: "claimed",
      attempts: 5,
      claimedAt: staleAt,
      claimedBy: "crashed",
    });
    const retry = await enqueue({
      state: "claimed",
      attempts: 2,
      claimedAt: staleAt,
      claimedBy: "crashed",
    });
    let sends = 0;
    const result = await runEmailSendOnce("recovery", {
      now: () => now,
      transport: {
        send: async () => {
          sends++;
          return {
            ok: true as const,
            kind: "accepted" as const,
            providerId: randomUUID(),
          };
        },
      },
    });
    expect(result).toMatchObject({ claimed: 1, sent: 1, dead: 1 });
    expect(sends).toBe(1);
    expect(await stored(exhausted.id)).toMatchObject({
      state: "dead",
      attempts: 5,
      terminalCause: "attempts_exhausted",
      claimedBy: null,
    });
    expect(await stored(retry.id)).toMatchObject({
      state: "sent",
      attempts: 3,
    });
  });
  it("stops a permanent provider failure after one persisted execution, logs once and creates no notification", async () => {
    const row = await enqueue();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    let sends = 0;
    const dependencies = {
      now: () => now,
      transport: {
        send: async () => {
          sends++;
          expect((await stored(row.id)).attempts).toBe(1);
          return {
            ok: false as const,
            kind: "email_error" as const,
            name: "validation_error",
            status: 422,
            message: "private recipient prose",
          };
        },
      },
    };
    expect(await runEmailSendOnce("permanent", dependencies)).toMatchObject({
      claimed: 1,
      dead: 1,
      sent: 0,
      retrying: 0,
    });
    expect(await stored(row.id)).toMatchObject({
      state: "dead",
      attempts: 1,
      failureReason: "validation_error",
      terminalCause: "permanent",
      claimedBy: null,
      claimedAt: null,
    });
    await runEmailSendOnce("again", dependencies);
    expect(sends).toBe(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).not.toContain("private recipient prose");
    expect(
      await db
        .select()
        .from(emailDeliveries)
        .where(eq(emailDeliveries.schoolId, schoolId)),
    ).toHaveLength(1);
  });
});
