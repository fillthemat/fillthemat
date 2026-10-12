import { randomUUID } from "node:crypto";
import { and, eq, gt, gte, lt, lte, sql } from "drizzle-orm";
import { getDb, type Transaction } from "@/db";
import {
  type PoppyClient,
  poppyBlockedClients,
  poppyClientAdmissions,
  poppyClients,
  poppySessions,
} from "@/db/schema";
import {
  MAX_POPPY_NEW_CLIENTS_PER_DAY,
  MAX_POPPY_SESSIONS_PER_CLIENT_PER_HOUR,
} from "@/lib/security/limits";
import { PoppyError } from "./errors";

export async function requireUnblockedPoppyClient(
  clientId: string,
  db: Transaction | ReturnType<typeof getDb> = getDb(),
): Promise<void> {
  const [blocked] = await db
    .select({ clientId: poppyBlockedClients.clientId })
    .from(poppyBlockedClients)
    .where(eq(poppyBlockedClients.clientId, clientId));
  if (blocked) throw new PoppyError("invalid_client", 401);
}

/** The client row is the cross-School mutex, held through the Session insert.
 * Ended Sessions still count; renewals never call this creation-only gate. */
export async function requirePoppySessionCapacity(
  clientId: string,
  tx: Transaction,
): Promise<void> {
  await tx
    .select({ clientId: poppyClients.clientId })
    .from(poppyClients)
    .where(eq(poppyClients.clientId, clientId))
    .for("update");
  const now = new Date();
  const [usage] = await tx
    .select({
      count: sql<number>`count(*)::int`,
      oldest: sql<Date | null>`min(${poppySessions.createdAt})`,
    })
    .from(poppySessions)
    .where(
      and(
        eq(poppySessions.clientId, clientId),
        gt(poppySessions.createdAt, new Date(now.getTime() - 3600000)),
      ),
    );
  if ((usage?.count ?? 0) >= MAX_POPPY_SESSIONS_PER_CLIENT_PER_HOUR) {
    const retryAt = usage?.oldest
      ? new Date(usage.oldest).getTime() + 3600000
      : now.getTime() + 3600000;
    throw new PoppyError(
      "rate_limited",
      429,
      Math.max(1, Math.ceil((retryAt - now.getTime()) / 1000)),
    );
  }
}

async function admissionLock(tx: Transaction) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext('poppy-client-admission'))`,
  );
}

/** Reserve scarce capacity before DNS, metadata or crypto work. No transaction
 * holds a lock during networking. A crashed worker's fenced lease expires. The
 * platform day is UTC; an admission belongs to the day its reservation started. */
export async function admitPoppyClient(
  clientId: string,
  fetchClient: () => Promise<
    Omit<PoppyClient, "clientId" | "firstSeenAt" | "refreshingUntil">
  >,
): Promise<PoppyClient> {
  const db = getDb();
  const reservation = await db.transaction(async (tx) => {
    await admissionLock(tx);
    await requireUnblockedPoppyClient(clientId, tx);
    const [known] = await tx
      .select()
      .from(poppyClients)
      .where(eq(poppyClients.clientId, clientId));
    if (known) return { known };
    const now = new Date();
    const start = new Date(now);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 86400000);
    await tx
      .delete(poppyClientAdmissions)
      .where(lte(poppyClientAdmissions.expiresAt, now));
    const [pending] = await tx
      .select()
      .from(poppyClientAdmissions)
      .where(eq(poppyClientAdmissions.clientId, clientId));
    if (pending)
      throw new PoppyError(
        "invalid_client",
        429,
        Math.max(
          1,
          Math.ceil((pending.expiresAt.getTime() - now.getTime()) / 1000),
        ),
      );
    const [admitted] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(poppyClients)
      .where(
        and(
          gte(poppyClients.firstSeenAt, start),
          lt(poppyClients.firstSeenAt, end),
        ),
      );
    const [reserved] = await tx
      .select({
        count: sql<number>`count(*)::int`,
        nextExpiry: sql<Date | null>`min(${poppyClientAdmissions.expiresAt})`,
      })
      .from(poppyClientAdmissions)
      .where(
        and(
          gte(poppyClientAdmissions.createdAt, start),
          lt(poppyClientAdmissions.createdAt, end),
        ),
      );
    if (
      (admitted?.count ?? 0) + (reserved?.count ?? 0) >=
      MAX_POPPY_NEW_CLIENTS_PER_DAY
    ) {
      const retryAt = Math.min(
        end.getTime(),
        reserved?.nextExpiry
          ? new Date(reserved.nextExpiry).getTime()
          : end.getTime(),
      );
      throw new PoppyError(
        "invalid_client",
        429,
        Math.max(1, Math.ceil((retryAt - now.getTime()) / 1000)),
      );
    }
    const [lease] = await tx
      .insert(poppyClientAdmissions)
      .values({
        clientId,
        leaseId: randomUUID(),
        createdAt: now,
        expiresAt: new Date(now.getTime() + 25000),
      })
      .returning();
    if (!lease) throw new Error("failed to reserve Poppy admission");
    return { lease };
  });
  if (reservation.known) return reservation.known;
  const lease = reservation.lease;
  try {
    const fetched = await fetchClient();
    return await db.transaction(async (tx) => {
      await admissionLock(tx);
      await requireUnblockedPoppyClient(clientId, tx);
      const [active] = await tx
        .select()
        .from(poppyClientAdmissions)
        .where(
          and(
            eq(poppyClientAdmissions.clientId, clientId),
            eq(poppyClientAdmissions.leaseId, lease.leaseId),
          ),
        );
      if (!active || active.expiresAt <= new Date())
        throw new PoppyError("invalid_client", 401);
      const [client] = await tx
        .insert(poppyClients)
        .values({ clientId, ...fetched, firstSeenAt: lease.createdAt })
        .returning();
      if (!client) throw new Error("failed to admit Poppy client");
      await tx
        .delete(poppyClientAdmissions)
        .where(eq(poppyClientAdmissions.clientId, clientId));
      return client;
    });
  } finally {
    await db
      .delete(poppyClientAdmissions)
      .where(
        and(
          eq(poppyClientAdmissions.clientId, clientId),
          eq(poppyClientAdmissions.leaseId, lease.leaseId),
        ),
      );
  }
}
