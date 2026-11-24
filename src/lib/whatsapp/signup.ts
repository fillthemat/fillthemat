import "server-only";
import { randomInt } from "node:crypto";
import { z } from "zod";
import type { Fetcher } from "@/lib/fetcher";
import { createAdminClient } from "@/lib/supabase/admin";
import { whatsappApiVersion, whatsappAppId, whatsappGraphBase } from "./config";
import { encryptWhatsAppSecret } from "./encryption";

const providerId = z.string().regex(/^\d+$/).max(100);
export const signupInput = z.object({
  code: z.string().min(1).max(4096),
  phoneNumberId: providerId,
  wabaId: providerId,
});
type SignupInput = z.infer<typeof signupInput>;
type RegisteredConnection = SignupInput & {
  displayPhoneNumber: string;
  verifiedName: string;
  encryptedToken: string;
  encryptedPin: string;
};

export async function setWhatsAppSignupState(
  schoolId: string,
  state: "popup" | "cancelled" | "popup-failed" | "registering" | "failed",
  failureCode: string | null = null,
) {
  await createAdminClient()
    .from("whatsapp_connections")
    .upsert({ school_id: schoolId, state, failure_code: failureCode })
    .throwOnError();
}

const defaultDependencies = {
  fetch: ((...args) => fetch(...args)) satisfies Fetcher,
  appId: whatsappAppId,
  appSecret: () => process.env.WHATSAPP_APP_SECRET ?? null,
  encrypt: encryptWhatsAppSecret,
  setState: setWhatsAppSignupState,
  save: async (schoolId: string, connection: RegisteredConnection) => {
    await createAdminClient()
      .rpc("finish_whatsapp_signup", {
        p_school_id: schoolId,
        p_phone_number_id: connection.phoneNumberId,
        p_waba_id: connection.wabaId,
        p_display_phone_number: connection.displayPhoneNumber,
        p_verified_name: connection.verifiedName,
        p_encrypted_token: connection.encryptedToken,
        p_encrypted_pin: connection.encryptedPin,
      })
      .throwOnError();
  },
};

/** Ownership and school eligibility are checked by the dashboard action first. */
export async function completeSignup(
  schoolId: string,
  input: SignupInput,
  overrides: Partial<typeof defaultDependencies> = {},
): Promise<{ ok: true } | { ok: false; code: string }> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const parsed = signupInput.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid_signup" };
  const appId = dependencies.appId();
  const appSecret = dependencies.appSecret();
  if (!appId || !appSecret) return { ok: false, code: "signup_unconfigured" };
  // Validate encryption configuration before exchanging the short-lived code.
  const pin = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const base = `${whatsappGraphBase()}/${whatsappApiVersion()}`;
  let step = "encryption";
  const request = async (path: string, token?: string, body?: Record<string, unknown>) => {
    const response = await dependencies.fetch(`${base}/${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        "content-type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10_000),
    });
    const json: unknown = await response.json();
    if (!response.ok || (json && typeof json === "object" && "error" in json)) {
      throw new Error("graph_rejected");
    }
    return json;
  };
  try {
    const encryptedPin = dependencies.encrypt(pin, schoolId);
    step = "save_registering";
    await dependencies.setState(schoolId, "registering");
    step = "token_exchange";
    const query = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      code: parsed.data.code,
    });
    const { access_token: token } = z
      .object({ access_token: z.string().min(1) })
      .parse(await request(`oauth/access_token?${query}`));
    step = "phone_lookup";
    const phone = z
      .object({ display_phone_number: z.string().min(1), verified_name: z.string().min(1) })
      .parse(
        await request(
          `${parsed.data.phoneNumberId}?fields=display_phone_number,verified_name`,
          token,
        ),
      );
    step = "subscribe";
    z.object({ success: z.literal(true) }).parse(
      await request(`${parsed.data.wabaId}/subscribed_apps`, token, {}),
    );
    step = "register";
    z.object({ success: z.literal(true) }).parse(
      await request(`${parsed.data.phoneNumberId}/register`, token, {
        messaging_product: "whatsapp",
        pin,
      }),
    );
    step = "save_connection";
    await dependencies.save(schoolId, {
      ...parsed.data,
      displayPhoneNumber: phone.display_phone_number,
      verifiedName: phone.verified_name,
      encryptedToken: dependencies.encrypt(token, schoolId),
      encryptedPin,
    });
    return { ok: true };
  } catch {
    const code = `${step}_failed`;
    // Never log Graph URLs, access tokens, authorization codes or PINs.
    console.error(JSON.stringify({ event: "whatsapp_signup_failed", schoolId, code }));
    await dependencies.setState(schoolId, "failed", code);
    return { ok: false, code };
  }
}
