import type { InboundWhatsAppMessage } from "./parse";
import { publicSchoolIdForPhone } from "./queue-store";

export type ResolveInboundResult =
  | { resolved: true; schoolId: string }
  | { resolved: false; reason: "unknown_phone_number" | "empty_text" };

/** Resolve the school only; the conversations module owns channel identity. */
export async function resolveInboundSchool(
  input: InboundWhatsAppMessage,
): Promise<ResolveInboundResult> {
  if (!input.text) return { resolved: false, reason: "empty_text" };
  const schoolId = await publicSchoolIdForPhone(input.phoneNumberId);
  if (!schoolId) return { resolved: false, reason: "unknown_phone_number" };
  return { resolved: true, schoolId };
}
