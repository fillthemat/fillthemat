// THROWAWAY: every Channel Connection reaches exactly one Agent of one Operator.
import { createWhatsAppAdapter } from "@chat-adapter/whatsapp";
import { assistant } from "./agents";
const web = core.connect({ operatorId: app.operatorId, agentId: assistant.agentId, channel: "web" });
const whatsapp = core.connect({ operatorId: app.operatorId, agentId: assistant.agentId, channel: "whatsapp" });
const poppy = core.connect({ operatorId: app.operatorId, agentId: assistant.agentId, channel: "poppy" });
const whatsappAdapter = createWhatsAppAdapter(app.whatsappCredentials);

async function accept(connection, authenticatedEvent) {
  return core.accept(connection, authenticatedEvent, { lifecycle: app.lifecycle });
} // Core atomically stores Turn + dispatch intent, dedupes, serializes Conversation.
// Conversation stays with its Agent + channel-specific Counterpart; ended means new.
export async function webChat(request) {
  const event = await app.authorizeWebInput(request, web); // Resume-token scope too.
  const accepted = await accept(web, event);
  return app.webReply(accepted); // Existing AI SDK UI path; committed output only here.
} // Do not put detached Workflow output through Chat's request-bound web adapter.
export async function whatsappWebhook(request) {
  const event = await app.verifyAndParseWhatsApp(request, whatsapp);
  if (event.isReceipt) return core.recordReceipt(event); // Keep status ingestion.
  await accept(whatsapp, event); // Failure must NOT return success to Meta.
  return app.acknowledge(); // No direct Chat webhook admission/dedupe/queue authority.
}
export async function poppyMessage(request) {
  const event = await app.authorizePoppyInput(request, poppy); // Issuer + session scope.
  return app.poppyReply(await accept(poppy, event)); // Personal Agent Counterpart.
} // Issuer/session -> Counterpart mapping is an open question; no identity merging.
// Proposed transport bridge, NOT a Chat SDK API; prove per-chunk evidence first.
core.useTransport(whatsapp, app.chatSdkBridge(whatsappAdapter));
// Existing jobs/outbox dispatch committed IDs; Workflow start needs reconciliation.
