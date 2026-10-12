import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { cronRuns } from "@/db/schema";
import { endInactiveConversations } from "@/lib/conversations/conversation-store";
import { runEmailSendOnce } from "@/lib/email/deliveries";
import {
  type EmailSendDependencies,
  emailSendDependencies,
} from "@/lib/email/dependencies";
import { createDueReminderDeliveries } from "@/lib/email/maintenance";
import { purgePoppyBudgetUsages } from "@/lib/poppy/budgets";
import { recheckSchoolDomains } from "@/lib/poppy/domain-maintenance";
import { failStalePoppyOperations } from "@/lib/poppy/operations";
import { purgePoppyReplays } from "@/lib/poppy/replay";

/** Email work goes first so slow or failed external domain checks cannot starve it. */
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
    const endedConversationCount = await endInactiveConversations(
      dependencies.now(),
    );
    await purgePoppyReplays(dependencies.now());
    await purgePoppyBudgetUsages(dependencies.now());
    await failStalePoppyOperations(dependencies.now());
    await recheckSchoolDomains();
    // Keep same-run delivery of newly queued domain-drop notifications without
    // exceeding the existing per-run email batch limit.
    const remaining = Math.max(0, 25 - sends.claimed);
    const notifications =
      remaining > 0
        ? await runEmailSendOnce(run.id, dependencies, { limit: remaining })
        : { sent: 0, retrying: 0, dead: 0 };
    const [updated] = await db
      .update(cronRuns)
      .set({
        finishedAt: dependencies.now(),
        reminderCount,
        sentCount: sends.sent + notifications.sent,
        failedCount:
          sends.retrying +
          sends.dead +
          notifications.retrying +
          notifications.dead,
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
