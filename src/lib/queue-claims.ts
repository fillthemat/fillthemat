import { and, eq, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

type Claim = {
  id: string;
  claimedAt: Date | null;
  claimedBy: string | null;
  attempts: number;
};
type ClaimColumns = { [K in keyof Claim]: AnyPgColumn } & {
  state: AnyPgColumn;
};

/** Fences every finalizer against a reclaimed or newly started execution. */
export function ownedQueueClaim(table: ClaimColumns, row: Claim) {
  return and(
    eq(table.id, row.id),
    eq(table.state, "claimed"),
    eq(table.claimedBy, row.claimedBy ?? ""),
    row.claimedAt ? eq(table.claimedAt, row.claimedAt) : sql`false`,
    eq(table.attempts, row.attempts),
  );
}

type LaneRow = { id: string; attempts: number; createdAt: Date };

/** Select under one transaction's SKIP LOCKED locks; refill either spare lane. */
export async function takeClaimLanes<Row extends LaneRow>(
  limit: number,
  take: (
    fresh: boolean,
    count: number,
    excludedIds: string[],
  ) => Promise<Row[]>,
  retryOnly = false,
): Promise<Row[]> {
  const due: Row[] = [];
  const retryCapacity = Math.floor(limit / 5);
  for (const [fresh, capacity] of [
    [true, limit - retryCapacity],
    [false, retryCapacity],
    [true, null],
    [false, null],
  ] as const) {
    const count = capacity ?? limit - due.length;
    if (count > 0 && !(fresh && retryOnly))
      due.push(
        ...(await take(
          fresh,
          count,
          due.map((row) => row.id),
        )),
      );
  }
  return due;
}

/** UPDATE RETURNING is unordered; restore fresh-first and oldest-first ordering. */
export function orderClaimedRows<Row extends LaneRow>(
  due: Row[],
  claimed: Row[],
): Row[] {
  const byId = new Map(claimed.map((row) => [row.id, row]));
  return due
    .sort(
      (a, b) =>
        Number(a.attempts > 0) - Number(b.attempts > 0) ||
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.id.localeCompare(b.id),
    )
    .map((row) => byId.get(row.id))
    .filter((row): row is Row => !!row);
}

/** Queue-specific updates and transactional death hooks stay with their queue. */
export async function recoverClaimedRows<Row extends { state: string }>(
  stale: Row[],
  recover: (row: Row) => Promise<Row | undefined>,
) {
  const dead: Row[] = [];
  for (const claim of stale) {
    const row = await recover(claim);
    if (row?.state === "dead") dead.push(row);
  }
  return { recovered: stale.length, dead };
}
