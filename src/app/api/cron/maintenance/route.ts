import { runMaintenance } from "@/lib/email/maintenance";
import { cronSecretMatches } from "@/lib/request";

export async function GET(request: Request) {
  if (!cronSecretMatches(request.headers.get("authorization"))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const run = await runMaintenance();
  return Response.json({
    id: run.id,
    result: run.result,
    sentCount: run.sentCount,
    failedCount: run.failedCount,
    reminderCount: run.reminderCount,
    endedConversationCount: run.endedConversationCount,
  });
}
