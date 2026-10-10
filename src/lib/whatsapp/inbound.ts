import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { schools } from "@/db/schema";
import type { InboundWhatsAppMessage } from "./parse";

export type ResolveInboundResult =
  | { resolved: true; schoolId: string }
  | { resolved: false; reason: "unknown_phone_number" | "empty_text" };

/** Resolve the school only; the conversations module owns channel identity. */
export async function resolveInboundSchool(
  input: InboundWhatsAppMessage,
): Promise<ResolveInboundResult> {
  if (!input.text) return { resolved: false, reason: "empty_text" };
  const [school] = await getDb()
    .select({ id: schools.id })
    .from(schools)
    .where(eq(schools.whatsappPhoneNumberId, input.phoneNumberId))
    .limit(1);
  if (!school) return { resolved: false, reason: "unknown_phone_number" };
  return { resolved: true, schoolId: school.id };
}
