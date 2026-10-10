import { isDeepStrictEqual } from "node:util";
import type {
  BookingIntent,
  CompletedReply,
  LeadRequest,
} from "../../src/lib/ai/assistant";
import type { assistantTools } from "../../src/lib/ai/tools";

export type Score = { name: string; value: number; comment?: string };
type ToolName = keyof ReturnType<typeof assistantTools>;
export type ToolExpectations = {
  called: readonly ToolName[];
  notCalled: readonly ToolName[];
};
export type IntentExpectations = {
  bookingIntent: BookingIntent | null;
  leadRequest: LeadRequest | null;
};

export function scoreIntents(
  expected: IntentExpectations,
  reply: Pick<CompletedReply, "bookingIntent" | "leadRequest">,
): Score[] {
  const lead = reply.leadRequest;
  const normalizedLead =
    expected.leadRequest?.statedNeed === "non-empty" && lead?.statedNeed?.trim()
      ? { ...lead, statedNeed: "non-empty" }
      : lead;
  return [
    {
      name: "bookingIntent",
      value: Number(
        isDeepStrictEqual(expected.bookingIntent, reply.bookingIntent),
      ),
    },
    {
      name: "leadRequest",
      value: Number(isDeepStrictEqual(expected.leadRequest, normalizedLead)),
    },
  ];
}

function canonicalTool(name: string): string {
  return (
    (
      {
        list_trial_slots: "list_trial_occurrences",
        capture_lead: "request_contact",
      } as Record<string, string>
    )[name] ?? name
  );
}

export function scoreToolCalls(
  expected: ToolExpectations,
  calls: string[],
): Score[] {
  calls = calls.map(canonicalTool);
  return [
    ...expected.called.map((name) => ({
      name: `tool:${canonicalTool(name)}:called`,
      value: Number(calls.includes(canonicalTool(name))),
    })),
    ...expected.notCalled.map((name) => ({
      name: `tool:${canonicalTool(name)}:not-called`,
      value: Number(!calls.includes(canonicalTool(name))),
    })),
  ];
}
