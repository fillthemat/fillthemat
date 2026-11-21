import "server-only";
import { endInactiveConversations } from "@/lib/conversations/conversation-store";
import { createAdminClient } from "@/lib/supabase/admin";
import { runEmailSendOnce } from "./deliveries";
import { type EmailSendDependencies, emailSendDependencies } from "./dependencies";

export async function createDueReminderDeliveries(now = new Date()) {
  const { data } = await createAdminClient()
    .rpc("enqueue_email_reminders", { p_now: now.toISOString() })
    .throwOnError();
  return data ?? 0;
}

export async function runMaintenance(overrides: Partial<EmailSendDependencies> = {}) {
  const dependencies = emailSendDependencies(overrides);
  const client = createAdminClient();
  const { data: run } = await client
    .from("cron_runs")
    .insert({ started_at: dependencies.now().toISOString() })
    .select()
    .single()
    .throwOnError();
  if (!run) throw new Error("failed to create cron run");
  try {
    const reminderCount = await createDueReminderDeliveries(dependencies.now());
    const sends = await runEmailSendOnce(run.id, dependencies);
    const endedConversationCount = await endInactiveConversations(dependencies.now());
    const { data } = await client
      .from("cron_runs")
      .update({
        finished_at: dependencies.now().toISOString(),
        reminder_count: reminderCount,
        sent_count: sends.sent,
        failed_count: sends.retrying + sends.dead,
        ended_conversation_count: endedConversationCount,
        result: "success",
      })
      .eq("id", run.id)
      .select()
      .single()
      .throwOnError();
    if (!data) throw new Error("failed to finish cron run");
    return data;
  } catch (error) {
    const message = error instanceof Error ? error.message : "maintenance_failed";
    await client
      .from("cron_runs")
      .update({
        finished_at: dependencies.now().toISOString(),
        result: "error",
        error_summary: message.slice(0, 500),
      })
      .eq("id", run.id)
      .throwOnError();
    throw error;
  }
}
