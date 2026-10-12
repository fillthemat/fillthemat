import { randomUUID } from "node:crypto";
import { getDb } from "@/db";
import { appendMessage } from "@/lib/conversations/conversation-store";
import { assertNoDirectChild } from "./conversation-direct";
import {
  appendPoppyEvent,
  conversationState,
  setPoppyState,
} from "./conversation-events";
import { ownedPoppyConversation } from "./conversations";
import { PoppyError } from "./errors";
import type { PoppyPrincipal } from "./protected-request";

export async function handoffPoppyConversation(
  principal: PoppyPrincipal,
  id: string,
) {
  return getDb().transaction(async (tx) => {
    const conversation = await ownedPoppyConversation(principal, id, tx);
    if (conversation.endedAt) throw new PoppyError("conversation_closed", 409);
    await assertNoDirectChild(conversation, tx);
    const messageId = `msg_${randomUUID()}`;
    const text = "No one at the School is available through this channel.";
    await appendMessage(
      {
        conversationId: id,
        messageId,
        role: "assistant",
        parts: [{ type: "text", text }],
      },
      { transaction: tx },
    );
    await appendPoppyEvent(
      conversation,
      {
        type: "message",
        message: { id: messageId, role: "company", sender: "agent", text },
      },
      tx,
    );
    await setPoppyState(conversation, "idle", tx);
    return conversationState(conversation);
  });
}
