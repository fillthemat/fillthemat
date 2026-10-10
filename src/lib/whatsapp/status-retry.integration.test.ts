import { randomUUID } from "node:crypto";
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
import { whatsappDeliveries } from "@/db/schema";
import { authSql, loadLocalEnv } from "@/test/integration-env";
import { deleteSchoolOwner, seedSchool } from "@/test/seed-school";
import type { WhatsAppSendOutcome } from "./client";
import {
  applyWhatsAppStatuses,
  claimDueWhatsAppDeliveries,
  drainDueWhatsAppDeliveries,
  enqueueWhatsAppDelivery,
  sendWhatsAppDelivery,
} from "./deliveries";
import type { InboundWhatsAppStatus } from "./status";

loadLocalEnv();
const db = getDb();
const sql = authSql();
const ownerId = randomUUID();
const suffix = randomUUID();
// Earlier than other worktrees' historical fixtures: the worker claims globally.
const initialNow = new Date("2000-01-01T12:00:00Z");
let now = initialNow;
let schoolId: string;
const ids: string[] = [];
const send = vi.fn(
  async (): Promise<WhatsAppSendOutcome> => ({
    ok: true,
    kind: "accepted",
    providerId: `fake:${randomUUID()}`,
  }),
);
const dependencies = {
  now: () => new Date(now),
  sleep: async () => {
    throw new Error("unexpected sleep");
  },
  transport: { sendText: send, sendTemplate: send, sendInteractive: send },
};

beforeAll(async () => {
  schoolId = (
    await seedSchool(sql, {
      ownerId,
      name: "Callback Retry School",
      slug: `sr-${suffix}`,
      offerings: [{ name: "BJJ" }],
    })
  ).schoolId;
});
afterEach(async () => {
  if (ids.length)
    await db
      .delete(whatsappDeliveries)
      .where(inArray(whatsappDeliveries.id, ids));
  ids.length = 0;
  now = initialNow;
  send.mockClear();
  vi.restoreAllMocks();
});
afterAll(async () => {
  await deleteSchoolOwner(sql, ownerId);
  await sql.end({ timeout: 5 });
});
async function enqueue() {
  const id = await enqueueWhatsAppDelivery(
    {
      schoolId,
      phoneNumberId: `callback-${suffix}`,
      recipientWaId: "16505550083",
      providerIdempotencyKey: `callback/${randomUUID()}`,
      body: "Private reply",
      windowExpiresAt: new Date("2000-01-02T12:00:00Z"),
    },
    now,
  );
  if (!id) throw new Error("enqueue failed");
  ids.push(id);
  return id;
}
async function delivery(id: string) {
  const [row] = await db
    .select()
    .from(whatsappDeliveries)
    .where(eq(whatsappDeliveries.id, id));
  return row;
}
async function run() {
  // Callback assertions observe one claim batch; in-run timing is covered by
  // the worker suite rather than advancing beyond the callback's due gate here.
  return {
    deliveries: await drainDueWhatsAppDeliveries(
      randomUUID(),
      25,
      dependencies,
    ),
  };
}
function status(
  wamid: string | null,
  overrides: Partial<InboundWhatsAppStatus> = {},
): InboundWhatsAppStatus {
  if (!wamid) throw new Error("expected an accepted provider message ID");
  return {
    wamid,
    status: "failed",
    recipientId: null,
    timestamp: now.getTime() / 1000,
    errorCode: "131000",
    errorMessage: "Private provider error",
    ...overrides,
  };
}

describe("WhatsApp accepted-send failure callbacks", () => {
  it.each([
    { code: "131026", details: null, expected: "dead" },
    { code: "1", details: "Invalid parameter", expected: "dead" },
    { code: "1", details: null, expected: "failed" },
    { code: "987654", details: null, expected: "failed" },
    { code: null, details: null, expected: "failed" },
    { code: "not-a-code", details: null, expected: "failed" },
  ])(
    "classifies callback code $code and details $details as $expected",
    async ({ code, details, expected }) => {
      const id = await enqueue();
      await run();
      const accepted = await delivery(id);
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      await applyWhatsAppStatuses(
        [
          status(accepted.providerId, {
            errorCode: code,
            errorDetails: details,
            errorSubcode: 131026,
            // Message prose and subcode must not substitute for structured code/details.
            errorMessage: "Invalid parameter with private phone 16505550083",
          }),
        ],
        { now: dependencies.now },
      );
      expect(await delivery(id)).toMatchObject({
        state: expected,
        attempts: 1,
        failureCode: code && /^\d+$/.test(code) ? Number(code) : null,
        terminalCause: expected === "dead" ? "permanent" : null,
      });
      now = new Date("2000-01-01T12:00:09Z");
      expect((await run()).deliveries.claimed).toBe(0);
      expect(send).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledTimes(expected === "dead" ? 1 : 0);
      if (expected === "dead") {
        expect(log.mock.calls[0][0]).not.toContain("Private");
        expect(log.mock.calls[0][0]).not.toContain("16505550083");
        expect(log.mock.calls[0][0]).not.toContain(accepted.providerId);
      }
    },
  );

  it.each([initialNow.getTime() / 1000, null])(
    "does not re-schedule a repeated failed callback with timestamp %s",
    async (timestamp) => {
      const id = await enqueue();
      await run();
      const accepted = await delivery(id);
      const failed = status(accepted.providerId, { timestamp });
      await applyWhatsAppStatuses([failed], { now: dependencies.now });
      const firstFailure = await delivery(id);
      now = new Date("2000-01-01T12:00:05Z");
      await Promise.all([
        applyWhatsAppStatuses([failed], { now: dependencies.now }),
        applyWhatsAppStatuses([failed], { now: dependencies.now }),
      ]);
      // Even another failure report for this same send cannot postpone its retry.
      await applyWhatsAppStatuses([status(accepted.providerId)], {
        now: dependencies.now,
      });
      expect(await delivery(id)).toEqual(firstFailure);
      expect((await run()).deliveries.claimed).toBe(0);
      now = new Date("2000-01-01T12:00:10Z");
      expect((await run()).deliveries.sent).toBe(1);
      expect((await delivery(id)).attempts).toBe(2);
    },
  );

  it("ignores older and equal failed callbacks after a newer sent receipt", async () => {
    const id = await enqueue();
    await run();
    const accepted = await delivery(id);
    await applyWhatsAppStatuses(
      [
        status(accepted.providerId, {
          status: "sent",
          timestamp: initialNow.getTime() / 1000 + 20,
        }),
      ],
      { now: dependencies.now },
    );
    const latest = await delivery(id);
    await applyWhatsAppStatuses(
      [
        status(accepted.providerId, {
          timestamp: initialNow.getTime() / 1000 + 10,
        }),
        status(accepted.providerId, {
          timestamp: initialNow.getTime() / 1000 + 20,
        }),
      ],
      { now: dependencies.now },
    );
    expect(await delivery(id)).toEqual(latest);
  });

  it.each(["delivered", "read"] as const)(
    "never resends after %s even when a newer permanent failure arrives",
    async (positive) => {
      const id = await enqueue();
      await run();
      const accepted = await delivery(id);
      await applyWhatsAppStatuses(
        [status(accepted.providerId, { status: positive })],
        { now: dependencies.now },
      );
      const confirmed = await delivery(id);
      now = new Date("2000-01-01T12:01:00Z");
      await applyWhatsAppStatuses(
        [status(accepted.providerId, { errorCode: "131026" })],
        { now: dependencies.now },
      );
      expect(await delivery(id)).toEqual(confirmed);
      expect((await run()).deliveries.claimed).toBe(0);
      expect(send).toHaveBeenCalledTimes(1);
      if (positive === "delivered") {
        await applyWhatsAppStatuses(
          [status(accepted.providerId, { status: "read" })],
          { now: dependencies.now },
        );
        expect((await delivery(id)).state).toBe("read");
      }
    },
  );

  it("allows delivered/read to reconcile a failed accepted send but not a later sent receipt", async () => {
    const id = await enqueue();
    await run();
    const accepted = await delivery(id);
    await applyWhatsAppStatuses([status(accepted.providerId)], {
      now: dependencies.now,
    });
    now = new Date("2000-01-01T12:00:01Z");
    await applyWhatsAppStatuses(
      [status(accepted.providerId, { status: "sent" })],
      { now: dependencies.now },
    );
    expect((await delivery(id)).state).toBe("failed");
    now = new Date("2000-01-01T12:00:02Z");
    await applyWhatsAppStatuses(
      [status(accepted.providerId, { status: "delivered" })],
      { now: dependencies.now },
    );
    expect(await delivery(id)).toMatchObject({
      state: "delivered",
      attempts: 1,
      failureReason: null,
      failureCode: null,
      terminalCause: null,
      lastError: null,
    });
    now = new Date("2000-01-01T12:01:00Z");
    expect((await run()).deliveries.claimed).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("logs concurrent terminal callbacks once and never revives a dead delivery", async () => {
    const id = await enqueue();
    await run();
    const accepted = await delivery(id);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = status(accepted.providerId, { errorCode: "131026" });
    await Promise.all([
      applyWhatsAppStatuses([failed], { now: dependencies.now }),
      applyWhatsAppStatuses([failed], { now: dependencies.now }),
    ]);
    const dead = await delivery(id);
    expect(dead.state).toBe("dead");
    now = new Date("2000-01-01T12:01:00Z");
    await applyWhatsAppStatuses(
      [
        status(accepted.providerId),
        status(accepted.providerId, { status: "delivered" }),
        status(accepted.providerId, { status: "read" }),
      ],
      { now: dependencies.now },
    );
    expect(await delivery(id)).toEqual(dead);
    expect(log).toHaveBeenCalledTimes(1);
    expect((await run()).deliveries.claimed).toBe(0);
  });
  it("cancels a claimed retry if the same accepted send is delivered before the next execution starts", async () => {
    const id = await enqueue();
    await run();
    const first = await delivery(id);
    await applyWhatsAppStatuses([status(first.providerId)], {
      now: dependencies.now,
    });
    now = (await delivery(id)).nextAttemptAt;
    const [claim] = await claimDueWhatsAppDeliveries(randomUUID(), {
      ids: [id],
      now,
    });
    await applyWhatsAppStatuses(
      [status(first.providerId, { status: "delivered" })],
      { now: dependencies.now },
    );
    expect(await delivery(id)).toMatchObject({
      state: "delivered",
      attempts: 1,
      claimedBy: null,
      claimedAt: null,
    });
    expect(await sendWhatsAppDelivery(claim, dependencies)).toBe("deferred");
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("does not let an old provider receipt finalize a newer failed execution", async () => {
    const id = await enqueue();
    await run();
    const first = await delivery(id);
    await applyWhatsAppStatuses([status(first.providerId)], {
      now: dependencies.now,
    });
    now = (await delivery(id)).nextAttemptAt;
    send.mockImplementationOnce(async () => ({
      ok: false,
      kind: "network_error",
      message: "Disconnected",
    }));
    await run();
    await applyWhatsAppStatuses(
      [
        status(first.providerId, {
          status: "delivered",
          timestamp: now.getTime() / 1000 + 1,
        }),
      ],
      { now: dependencies.now },
    );
    expect(await delivery(id)).toMatchObject({
      state: "failed",
      attempts: 2,
      failureReason: "network_error",
      providerId: null,
    });
  });
  it("scopes the timestamp watermark to the new provider attempt", async () => {
    const id = await enqueue();
    await run();
    const first = await delivery(id);
    await applyWhatsAppStatuses(
      [
        status(first.providerId, {
          timestamp: now.getTime() / 1000 + 60,
        }),
      ],
      { now: dependencies.now },
    );
    now = new Date("2000-01-01T12:00:10Z");
    await run();
    const second = await delivery(id);
    expect(second.providerId).not.toBe(first.providerId);
    await applyWhatsAppStatuses([status(second.providerId)], {
      now: dependencies.now,
    });
    expect(await delivery(id)).toMatchObject({
      state: "failed",
      attempts: 2,
      nextAttemptAt: new Date("2000-01-01T12:00:30Z"),
    });
  });
  it("uses each accepted execution once and stops after five accept-then-fail cycles", async () => {
    const id = await enqueue();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const [index, delay] of [
      10_000,
      20_000,
      40_000,
      80_000,
      null,
    ].entries()) {
      expect((await run()).deliveries.sent).toBe(1);
      const accepted = await delivery(id);
      expect(accepted.attempts).toBe(index + 1);
      await applyWhatsAppStatuses([status(accepted.providerId)], {
        now: dependencies.now,
      });
      const failed = await delivery(id);
      expect(failed).toMatchObject({
        attempts: index + 1,
        state: delay === null ? "dead" : "failed",
        failureReason: "whatsapp_error",
        failureCode: 131000,
        terminalCause: delay === null ? "attempts_exhausted" : null,
        claimedAt: null,
        claimedBy: null,
      });
      if (delay !== null) {
        expect(failed.nextAttemptAt).toEqual(new Date(now.getTime() + delay));
        expect((await run()).deliveries.claimed).toBe(0);
        now = failed.nextAttemptAt;
      }
    }
    expect(send).toHaveBeenCalledTimes(5);
    expect((await run()).deliveries.claimed).toBe(0);
    expect(log).toHaveBeenCalledTimes(1);
  });
});
