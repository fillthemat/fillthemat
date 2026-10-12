import { createHash } from "node:crypto";
import { and, asc, eq, gt, lte, sql } from "drizzle-orm";
import { getDb, type Transaction } from "@/db";
import { poppyBudgetUsages, poppySessions } from "@/db/schema";
import {
  MAX_POPPY_BOOKINGS_PER_CLIENT_PER_DAY,
  MAX_POPPY_BOOKINGS_PER_SCHOOL_PER_DAY,
  MAX_POPPY_BOOKINGS_PER_USER_PER_DAY,
  MAX_POPPY_CONVERSATIONS_PER_USER_PER_DAY,
  MAX_POPPY_PROPOSALS_PER_USER_PER_DAY,
} from "@/lib/security/limits";
import { PoppyError } from "./errors";

type BudgetOwner = { schoolId: string; clientId: string; userId: string };
const DAY_MS = 24 * 60 * 60 * 1000;

export async function purgePoppyBudgetUsages(now = new Date()) {
  await getDb()
    .delete(poppyBudgetUsages)
    .where(lte(poppyBudgetUsages.expiresAt, now));
}

/** Holds the key lock until the enclosing effect transaction commits. Usage is
 * inserted only by successful effects, so rollback/replay never spends capacity. */
async function reserveBudget(
  identity: string[],
  limit: number,
  expiresAt: Date,
  tx: Transaction,
  now: Date,
) {
  const key = createHash("sha256")
    .update(JSON.stringify(identity))
    .digest("hex");
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
  );
  const active = await tx
    .select({ expiresAt: poppyBudgetUsages.expiresAt })
    .from(poppyBudgetUsages)
    .where(
      and(eq(poppyBudgetUsages.key, key), gt(poppyBudgetUsages.expiresAt, now)),
    )
    .orderBy(asc(poppyBudgetUsages.expiresAt));
  if (active.length >= limit) {
    const available = active[active.length - limit];
    return {
      retryAfter: Math.max(
        1,
        Math.ceil(
          ((available?.expiresAt.getTime() ?? expiresAt.getTime()) -
            now.getTime()) /
            1000,
        ),
      ),
    };
  }
  return {
    consume: () => tx.insert(poppyBudgetUsages).values({ key, expiresAt }),
  };
}

export async function consumeConversationBudget(
  owner: BudgetOwner,
  tx: Transaction,
  now = new Date(),
) {
  const budget = await reserveBudget(
    ["poppy-conversations", owner.schoolId, owner.clientId, owner.userId],
    MAX_POPPY_CONVERSATIONS_PER_USER_PER_DAY,
    new Date(now.getTime() + DAY_MS),
    tx,
    now,
  );
  if (budget.retryAfter)
    throw new PoppyError("rate_limited", 429, budget.retryAfter);
  await budget.consume?.();
}

/** Shared by booking/lead and API/Conversation proposals. Call only after
 * identical open-action reuse, once for each newly issued terms revision. */
export async function consumeProposalBudget(
  input: { schoolId: string; sessionId: string },
  tx: Transaction,
  now = new Date(),
) {
  const [session] = await tx
    .select()
    .from(poppySessions)
    .where(
      and(
        eq(poppySessions.id, input.sessionId),
        eq(poppySessions.schoolId, input.schoolId),
      ),
    );
  if (!session) throw new Error("proposal_session_missing");
  const budget = await reserveBudget(
    ["poppy-proposals", input.schoolId, session.clientId, session.userId],
    MAX_POPPY_PROPOSALS_PER_USER_PER_DAY,
    new Date(now.getTime() + DAY_MS),
    tx,
    now,
  );
  if (budget.retryAfter)
    throw new PoppyError("rate_limited", 429, budget.retryAfter);
  await budget.consume?.();
}

export async function reserveBookingBudgets(
  owner: BudgetOwner,
  timezone: string,
  tx: Transaction,
  now = new Date(),
) {
  // PostgreSQL resolves the next local midnight including DST (not now + 24h).
  const [day] = await tx.execute<{ day: string; expires: string }>(sql`
    select (${now.toISOString()}::timestamptz at time zone ${timezone})::date::text as day,
      (((${now.toISOString()}::timestamptz at time zone ${timezone})::date + 1)::timestamp at time zone ${timezone}) as expires
  `);
  if (!day) throw new Error("school_day_unavailable");
  const expiresAt = new Date(now.getTime() + DAY_MS);
  // Every booking takes locks in this order; no network work while locked.
  const definitions = [
    {
      identity: [
        "poppy-user-bookings",
        owner.schoolId,
        owner.clientId,
        owner.userId,
      ],
      limit: MAX_POPPY_BOOKINGS_PER_USER_PER_DAY,
      expiresAt,
      code: "poppy_user_booking_limit",
      summary: "the agent user's booking limit at this School was reached",
    },
    {
      identity: ["poppy-client-bookings", owner.clientId],
      limit: MAX_POPPY_BOOKINGS_PER_CLIENT_PER_DAY,
      expiresAt,
      code: "poppy_client_booking_limit",
      summary:
        "the Personal Agent's booking limit across all Schools was reached",
    },
    {
      identity: ["poppy-school-bookings", owner.schoolId, day.day],
      limit: MAX_POPPY_BOOKINGS_PER_SCHOOL_PER_DAY,
      expiresAt: new Date(day.expires),
      code: "poppy_school_booking_limit",
      summary: "the School's daily agent-sourced booking limit was reached",
    },
  ];
  const reservations: Array<Awaited<ReturnType<typeof reserveBudget>>> = [];
  for (const definition of definitions) {
    const budget = await reserveBudget(
      definition.identity,
      definition.limit,
      definition.expiresAt,
      tx,
      now,
    );
    if (budget.retryAfter)
      return {
        code: definition.code,
        summary: `No booking was made: ${definition.summary}.`,
      };
    reservations.push(budget);
  }
  return {
    consume: async () => {
      for (const budget of reservations) await budget.consume?.();
    },
  };
}
