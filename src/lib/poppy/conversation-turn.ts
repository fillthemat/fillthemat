import { randomUUID } from "node:crypto";
import { validateUIMessages } from "ai";
import { and, asc, count, eq, isNull } from "drizzle-orm";
import { getDb, type Transaction } from "@/db";
import {
  conversations,
  messages,
  poppyClients,
  poppyConversationMessages,
  schools,
} from "@/db/schema";
import { type CompletedReply, completedReply } from "@/lib/ai/assistant";
import {
  appendMessage,
  claimGeneration,
} from "@/lib/conversations/conversation-store";
import { loadSchoolCatalog } from "@/lib/schools/public";
import { MAX_CHAT_MESSAGES_PER_CONVERSATION } from "@/lib/security/limits";
import { startTurnTrace } from "@/lib/tracing/turn-trace";
import { loadPoppyTranscript } from "./conversation-direct";
import { appendPoppyEvent, setPoppyState } from "./conversation-events";
import { lockPoppyConversationRow } from "./conversation-lifecycle";
import { poppyMessage } from "./conversation-requests";
import { closePoppyConversationRow } from "./conversations";
import { proposeBookingOperation, supportsOperations } from "./operations";

async function nextMessage(conversationId: string) {
  const [receipt] = await getDb()
    .select()
    .from(poppyConversationMessages)
    .where(
      and(
        eq(poppyConversationMessages.conversationId, conversationId),
        isNull(poppyConversationMessages.completedAt),
      ),
    )
    .orderBy(asc(poppyConversationMessages.sequence))
    .limit(1);
  return receipt;
}

/** Durable inbound receipts form a per-Conversation queue. One shared generation
 * lock owns the drain; duplicates never call the model a second time. */
export async function completePoppyTurns(
  conversationId: string,
): Promise<void> {
  // Leave room for durable commits, lock release and trace export inside 120s.
  const deadline = Date.now() + 90_000;
  for (;;) {
    const lock = await claimGeneration(conversationId);
    if (!lock) return;
    try {
      for (;;) {
        if (Date.now() >= deadline) return;
        const receipt = await nextMessage(conversationId);
        if (!receipt) break;
        const db = getDb();
        const [conversation] = await db
          .select()
          .from(conversations)
          .where(eq(conversations.id, conversationId));
        if (!conversation) throw new Error("conversation_missing");
        const message = poppyMessage.parse(receipt.message);
        const [client] = await db
          .select()
          .from(poppyClients)
          .where(eq(poppyClients.clientId, conversation.poppyClientId ?? ""));
        const [school] = await db
          .select()
          .from(schools)
          .where(eq(schools.id, conversation.schoolId));
        if (!school || !client) throw new Error("conversation_owner_missing");
        const inboundId = randomUUID();
        const turn = startTurnTrace({
          channel: "poppy",
          conversationId,
          schoolId: school.id,
          inboundMessageId: inboundId,
          inboundText: message.text ?? "",
          clientDisplayName: client.displayName,
        });
        try {
          await turn.run(async () => {
            const history = await loadPoppyTranscript(conversation);
            let reply: CompletedReply | undefined;
            let completion: "complete" | "error" = "complete";
            try {
              reply = await completedReply({
                school,
                catalog: await loadSchoolCatalog(school.id),
                now: new Date(),
                poppy: {
                  sender: message.sender,
                  operationsSupported: supportsOperations(client.extensions),
                },
                abortSignal: AbortSignal.timeout(
                  Math.max(1, deadline - Date.now()),
                ),
                messages: await validateUIMessages({
                  messages: [
                    ...history,
                    {
                      id: message.id,
                      role: "user",
                      parts: [
                        {
                          type: "text",
                          text: modelMessage(
                            message.text,
                            message.data,
                            receipt.context,
                          ),
                        },
                      ],
                    },
                  ],
                }),
              });
            } catch {
              // The accepted Turn gets a durable, honestly failed reply rather
              // than staying working forever or regenerating on every poll.
              completion = "error";
              console.error(
                JSON.stringify({
                  event: "poppy_assistant_reply_failed",
                  conversationId,
                }),
              );
            }
            const text =
              (reply?.operationError === "extension_required"
                ? "extension_required: Your Personal Agent must support the Operations extension version 1 to propose and confirm a booking."
                : reply?.text) ??
              "I couldn't complete that reply. Please try a new message.";
            const replyMessageId = await db.transaction(async (tx) => {
              const current = await lockPoppyConversationRow(
                conversationId,
                tx,
              );
              if (!current) throw new Error("conversation_missing");
              await appendMessage(
                {
                  id: inboundId,
                  conversationId,
                  messageId: message.id,
                  role: "user",
                  parts: [
                    {
                      type: "text",
                      text: modelMessage(
                        message.text,
                        message.data,
                        receipt.context,
                      ),
                    },
                  ],
                },
                { transaction: tx },
              );
              const id = `msg_${randomUUID()}`;
              const savedReplyId = await appendMessage(
                {
                  conversationId,
                  messageId: id,
                  role: "assistant",
                  parts: [{ type: "text", text }],
                  completion,
                },
                { transaction: tx },
              );
              // Channel-specific proposals attach to this Company message in
              // the same transaction as the completed Turn.
              const operation = reply?.bookingIntent?.bookingTerms
                ? await proposeBookingOperation(
                    {
                      schoolId: school.id,
                      sessionId: receipt.sessionId,
                      conversationId,
                      terms: reply.bookingIntent.bookingTerms,
                    },
                    { transaction: tx },
                  )
                : undefined;
              await appendPoppyEvent(
                current,
                {
                  type: "message",
                  message: {
                    id,
                    role: "company",
                    sender: "agent",
                    text,
                    ...(operation ? { operation } : {}),
                    ...(reply?.operationError
                      ? {
                          data: {
                            error: reply.operationError,
                            extension: "operations",
                          },
                        }
                      : {}),
                  },
                },
                tx,
              );
              await tx
                .update(poppyConversationMessages)
                .set({ completedAt: new Date() })
                .where(eq(poppyConversationMessages.key, receipt.key));
              const [total] = await tx
                .select({ count: count() })
                .from(messages)
                .where(eq(messages.conversationId, conversationId));
              if ((total?.count ?? 0) >= MAX_CHAT_MESSAGES_PER_CONVERSATION)
                await closePoppyConversationRow(current, "message_limit", tx);
              else if (
                !current.endedAt &&
                !(await nextPendingInTransaction(conversationId, tx))
              )
                await setPoppyState(current, "idle", tx);
              return savedReplyId;
            });
            turn.end({
              text,
              messageId: replyMessageId,
              completion,
              provenance: reply?.provenance,
            });
          });
        } finally {
          await turn.exportWhenEnded();
        }
      }
    } finally {
      await lock.release();
    }
    // Close the acceptance-versus-unlock race: a newly queued receipt either
    // gets drained here or by its own request after the lock was released.
    if (!(await nextMessage(conversationId))) return;
  }
}

async function nextPendingInTransaction(
  conversationId: string,
  tx: Transaction,
) {
  const [pending] = await tx
    .select({ key: poppyConversationMessages.key })
    .from(poppyConversationMessages)
    .where(
      and(
        eq(poppyConversationMessages.conversationId, conversationId),
        isNull(poppyConversationMessages.completedAt),
      ),
    )
    .limit(1);
  return pending;
}

function modelMessage(
  text: string | undefined,
  data: Record<string, unknown> | undefined,
  context: Record<string, unknown>,
) {
  // JSON escapes prevent a client value from closing the content delimiters.
  const untrusted = JSON.stringify({ data: data ?? {}, context })
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e");
  return `${text ?? ""}\n\n<untrusted_poppy_content>\n${untrusted}\n</untrusted_poppy_content>`;
}
