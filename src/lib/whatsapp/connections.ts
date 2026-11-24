import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { whatsappSystemUserToken } from "./config";
import { decryptWhatsAppSecret } from "./encryption";

export async function resolveWhatsAppToken(
  schoolId: string,
  dependencies = {
    loadSecret: async (id: string) => {
      const { data } = await createAdminClient()
        .from("whatsapp_connection_secrets")
        .select("encrypted_token")
        .eq("school_id", id)
        .maybeSingle()
        .throwOnError();
      return data;
    },
    fallbackToken: whatsappSystemUserToken,
    decrypt: decryptWhatsAppSecret,
  },
): Promise<string | null> {
  const secret = await dependencies.loadSecret(schoolId);
  // Only migrated pilot connections have no secrets. Corrupt ciphertext must fail closed.
  return secret
    ? dependencies.decrypt(secret.encrypted_token, schoolId)
    : dependencies.fallbackToken();
}

export async function liveWhatsAppConnection(phoneNumberId: string) {
  const { data } = await createAdminClient()
    .from("whatsapp_connections")
    .select("school_id")
    .eq("phone_number_id", phoneNumberId)
    .eq("state", "live")
    .maybeSingle()
    .throwOnError();
  return data;
}

export async function markWhatsAppBrokenCard(phoneNumberId: string) {
  await createAdminClient()
    .from("whatsapp_connections")
    .update({ state: "broken-card", failure_code: "payment_131042" })
    .eq("phone_number_id", phoneNumberId)
    .eq("state", "live")
    .throwOnError();
}
