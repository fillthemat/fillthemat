// THROWAWAY: app registers a bounded, database-only callback; core opens the tx.
app.registerTurnEffects(assistant.agentId, async ({ tx, scope, actionId }, prepared) => {
  app.assertEffectBounds(prepared, { maxActions: 1 }); // Proposed bound; reject excess.
  const outcome = await app.applyBookingsAndLeads(tx, scope, prepared, actionId);
  return { reply: app.replyForValidatedOutcome(outcome), provenance: outcome.audit };
}); // Revalidate availability/authorization; actionId is core-derived, not model-chosen.
// No HTTP, model calls, publishing, detached work or nested transactions in callback.
export async function commitTurn(turnId, result) {
  return core.db.transaction(async (tx) => {
    const turn = await core.lockAcceptedTurn(tx, turnId);
    const conversation = await core.lockConversation(tx, turn.conversationId);
    core.assertScope(turn, conversation); // Operator/Agent/Connection/Counterpart match.
    const receipt = await core.committedReceipt(tx, turnId);
    if (receipt) return receipt; // Lost acknowledgement: no second callback/effect.
    core.assertActive(conversation); // Lifecycle decision remains app-owned.
    core.assertAgentControl(conversation); // Staff control suppresses Agent replies.
    core.assertControlNumber(conversation, turn.controlNumber); // Handoff increments it.
    const actionId = core.actionId(turnId, "app-effects"); // Stable across retries/runs.
    const validated = await app.effectsFor(turn.agentId)({
      tx, scope: core.validatedScope(conversation), actionId,
    }, result.prepared); // Same Drizzle tx; app alone knows bookings/leads tables.
    const reply = validated.reply ?? result.reply; // No unvalidated booking-success text.
    await core.recordTranscriptAndAudit(tx, turn, reply, validated.provenance);
    const outbound = await core.recordOutboundIntents(tx, turn, reply, {
      controlNumber: turn.controlNumber, // Frozen target/payload; stable per-chunk IDs.
    });
    return core.recordCommittedReceipt(tx, turnId, outbound); // All commit or rollback.
  });
} // Sender checks control again; in-flight/possibly-sent outcomes need reconciliation.
// Core imports no app tables; callback registration/composition lives in Fill the Mat.
