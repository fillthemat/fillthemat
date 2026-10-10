import { and, eq, gt } from "drizzle-orm";
import { getDb } from "@/db";
import { bookings, cronRuns, emailDeliveries } from "@/db/schema";
import { endInactiveConversations } from "@/lib/conversations/conversation-store";
import { shouldCreateReminder } from "@/lib/schedule/reminders";
import { runEmailSendOnce } from "./deliveries";
import {
  type EmailSendDependencies,
  emailSendDependencies,
} from "./dependencies";

export async function createDueReminderDeliveries(now = new Date()) {
  const db = getDb();
  const due = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.status, "booked"), gt(bookings.startAt, now)));

  let created = 0;
  for (const booking of due) {
    if (
      !shouldCreateReminder({
        createdAt: booking.createdAt,
        startAt: booking.startAt,
        now,
      })
    ) {
      continue;
    }
    // WhatsApp no-email bookings have no email reminder address; skip them
    // (their reminder medium is the WhatsApp template, a Phase 6 rollout step).
    if (!booking.contactEmailSnapshot) continue;
    const inserted = await db
      .insert(emailDeliveries)
      .values({
        schoolId: booking.schoolId,
        bookingId: booking.id,
        kind: "booking_reminder",
        recipient: booking.contactEmailSnapshot,
        providerIdempotencyKey: `booking-reminder/${booking.id}`,
        state: "pending",
        nextAttemptAt: now,
      })
      .onConflictDoNothing({
        target: emailDeliveries.providerIdempotencyKey,
      })
      .returning({ id: emailDeliveries.id });
    if (inserted[0]) created += 1;
  }
  return created;
}

export async function runMaintenance(
  overrides: Partial<EmailSendDependencies> = {},
) {
  const dependencies = emailSendDependencies(overrides);
  const db = getDb();
  const [run] = await db
    .insert(cronRuns)
    .values({ startedAt: dependencies.now() })
    .returning();
  if (!run) throw new Error("failed to create cron run");

  try {
    const reminderCount = await createDueReminderDeliveries(dependencies.now());
    const sends = await runEmailSendOnce(run.id, dependencies);
    const sentCount = sends.sent;
    const failedCount = sends.retrying + sends.dead;
    const endedConversationCount = await endInactiveConversations(
      dependencies.now(),
    );
    const [updated] = await db
      .update(cronRuns)
      .set({
        finishedAt: dependencies.now(),
        reminderCount,
        sentCount,
        failedCount,
        endedConversationCount,
        result: "success",
      })
      .where(eq(cronRuns.id, run.id))
      .returning();
    return updated ?? run;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "maintenance_failed";
    await db
      .update(cronRuns)
      .set({
        finishedAt: dependencies.now(),
        result: "error",
        errorSummary: message.slice(0, 500),
      })
      .where(eq(cronRuns.id, run.id));
    throw error;
  }
}
