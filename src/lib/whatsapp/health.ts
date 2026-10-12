import { z } from "zod";
import type { BrokenPart } from "./connection";

/** Account health is separate from queue retry policy. Recipient, window,
 * throttling and generic transport failures must never break the whole school.
 * Meta: 190/102 invalid token/session; 131042 payment/eligibility;
 * 131031 locked account; 133010 unregistered sending number.
 */
export function brokenPartFromMetaCode(code: number | null): BrokenPart | null {
  if (code === 190 || code === 102) return "access";
  if (code === 131042) return "card";
  if (code === 131031) return "restricted";
  if (code === 133010) return "number";
  return null;
}

const accountPayload = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z.array(
    z.object({
      id: z.string().regex(/^\d+$/),
      time: z.number().int().nonnegative(),
      changes: z.array(z.object({ field: z.string(), value: z.unknown() })),
    }),
  ),
});
const accountValue = z.object({
  event: z.string(),
  waba_info: z
    .object({
      waba_id: z.string().regex(/^\d+$/),
      partner_app_id: z.string().optional(),
    })
    .optional(),
  ban_info: z.object({ waba_ban_state: z.string() }).optional(),
});

/** account_update is routed by WABA, not message metadata. Partner events have
 * the customer's ID in waba_info (entry.id can be the provider's account).
 * Reinstatement/reconnection alone is never proof that sends can succeed.
 */
export function parseAccountUpdates(
  payload: unknown,
  appId: string | undefined,
) {
  const parsed = accountPayload.safeParse(payload);
  const updates: { wabaId: string; part: BrokenPart; at: Date }[] = [];
  if (!parsed.success) return updates;
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      if (change.field !== "account_update") continue;
      const value = accountValue.safeParse(change.value);
      if (!value.success) continue;
      const data = value.data;
      let part: BrokenPart | null = null;
      if (
        data.event === "ACCOUNT_RESTRICTION" ||
        (data.event === "DISABLED_UPDATE" &&
          data.ban_info?.waba_ban_state === "DISABLE")
      )
        part = "restricted";
      if (
        data.event === "ACCOUNT_DELETED" ||
        data.event === "ACCOUNT_OFFBOARDED"
      )
        part = "number";
      if (
        data.event === "PARTNER_APP_UNINSTALLED" &&
        appId &&
        data.waba_info?.partner_app_id === appId
      )
        part = "access";
      const at = new Date(entry.time * 1000);
      if (part && Number.isFinite(at.getTime()))
        updates.push({ wabaId: data.waba_info?.waba_id ?? entry.id, part, at });
    }
  }
  return updates;
}
