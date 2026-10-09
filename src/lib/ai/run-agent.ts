import { convertToModelMessages, type UIMessage } from "ai";
import type { School, TrialOffering, TrialWindow } from "@/db/schema";
import { isLocalAiStub } from "@/lib/dev-flags";
import type { SlotOccurrence } from "@/lib/schedule/occurrences";
import { createBookingAgent } from "./assistant";

export type PrepareBookingCapture = {
  offeringId: string;
  slotId: string;
  participantName: string | null;
  participantAge: number | null;
};

export type LeadCapture = {
  participantName: string | null;
  participantAge: number | null;
  offeringId: string | null;
  statedNeed: string | null;
};

export type BookingAgentRunResult = {
  text: string;
  prepareBooking: PrepareBookingCapture | null;
  lead: LeadCapture | null;
};

// The tool result union (`TypedToolResult`) is fully typed against the agent's
// inferred tool set; for this capture seam we only need the shared fields, so
// narrow to a structural record instead of hand-rolling the union.
type LooseToolResult = {
  type?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
};

function lastSuccessfulToolResult(
  result: { steps?: unknown },
  toolName: string,
): LooseToolResult | undefined {
  const steps = Array.isArray(result.steps)
    ? (result.steps as Array<{ toolResults?: unknown }>)
    : [];
  for (const step of [...steps].reverse()) {
    const toolResults = Array.isArray(step.toolResults)
      ? (step.toolResults as LooseToolResult[])
      : [];
    for (const toolResult of [...toolResults].reverse()) {
      if (
        toolResult.type === "tool-result" &&
        toolResult.toolName === toolName
      ) {
        return toolResult;
      }
    }
  }
  return undefined;
}

function extractPrepareBooking(result: {
  steps?: unknown;
}): PrepareBookingCapture | null {
  const toolResult = lastSuccessfulToolResult(result, "prepare_booking");
  const output = toolResult?.output as
    | {
        ok?: boolean;
        offering?: { id?: string };
        slot?: { slotId?: string };
        participantName?: unknown;
        participantAge?: unknown;
      }
    | undefined;
  if (!output?.ok || !output.offering?.id || !output.slot?.slotId) return null;
  return {
    offeringId: output.offering.id,
    slotId: output.slot.slotId,
    participantName:
      typeof output.participantName === "string"
        ? output.participantName
        : null,
    participantAge:
      typeof output.participantAge === "number" ? output.participantAge : null,
  };
}

function extractLead(result: { steps?: unknown }): LeadCapture | null {
  const toolResult = lastSuccessfulToolResult(result, "capture_lead");
  const output = toolResult?.output as
    | {
        ok?: boolean;
        participantName?: unknown;
        participantAge?: unknown;
        offeringId?: unknown;
        statedNeed?: unknown;
      }
    | undefined;
  if (!output?.ok) return null;
  return {
    participantName:
      typeof output.participantName === "string"
        ? output.participantName
        : null,
    participantAge:
      typeof output.participantAge === "number" ? output.participantAge : null,
    offeringId:
      typeof output.offeringId === "string" ? output.offeringId : null,
    statedNeed:
      typeof output.statedNeed === "string" ? output.statedNeed : null,
  };
}

/**
 * Server-side, non-streaming "collect parts" wrapper (decision D3). It runs the
 * exact same `ToolLoopAgent` (same tools/rules) as the web chat but to
 * completion via `agent.generate(...)` and returns the final text plus the last
 * successful `prepare_booking` / `capture_lead` tool outputs. The platform uses
 * those captures to persist a pending booking intent or a lead — the agent
 * itself never writes either.
 *
 * Local dev (no `VERCEL_OIDC_TOKEN`) short-circuits to the same deterministic
 * stub the web chat uses (with no captures), so the outbound queue is exercised
 * without a model.
 */
export async function runBookingAgentToCompletion({
  school,
  offerings,
  windows,
  occurrences,
  faqs,
  uiMessages,
  now,
}: {
  school: School;
  offerings: TrialOffering[];
  windows: TrialWindow[];
  occurrences: SlotOccurrence[];
  faqs: Array<{ question: string; answer: string }>;
  uiMessages: UIMessage[];
  now: Date;
}): Promise<BookingAgentRunResult> {
  if (isLocalAiStub()) {
    const offeringNames = offerings
      .filter((offering) => offering.active)
      .map((offering) => offering.name);
    const text =
      offeringNames.length > 0
        ? `Local chat stub (no VERCEL_OIDC_TOKEN). ${school.name} offers ${offeringNames.join(", ")}. Use Book Trial to confirm a slot.`
        : `Local chat stub (no VERCEL_OIDC_TOKEN). Use Book Trial on this page to pick a time at ${school.name}.`;
    return { text, prepareBooking: null, lead: null };
  }

  const agent = createBookingAgent({
    school,
    offerings,
    windows,
    occurrences,
    faqs,
    now,
  });

  const modelMessages = await convertToModelMessages(uiMessages, {
    tools: agent.tools,
  });
  const result = await agent.generate({ messages: modelMessages });

  return {
    text: result.text.trim(),
    prepareBooking: extractPrepareBooking(result),
    lead: extractLead(result),
  };
}
