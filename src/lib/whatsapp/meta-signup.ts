export type MetaSignupClient = {
  readReadiness(input: {
    token: string;
    wabaId: string;
    phoneNumberId: string;
  }): Promise<{
    registered: boolean;
    paymentMethod: boolean;
    profileName: string | null;
  }>;
  exchangeCode(
    code: string,
  ): Promise<{ token: string; expiresAt: Date | null }>;
  validateNumber(input: {
    token: string;
    wabaId: string;
    phoneNumberId: string;
    number: string;
  }): Promise<boolean>;
  subscribe(input: { token: string; wabaId: string }): Promise<void>;
  register(input: {
    token: string;
    phoneNumberId: string;
    pin: string;
  }): Promise<void>;
};

/** Expected provider refusals; never include provider payloads or credentials. */
export class MetaSignupError extends Error {
  constructor(
    public readonly code: "signup_failed" | "unconfigured" | "invalid_assets",
  ) {
    super(code);
  }
}

export function metaSignupFromEnv(): MetaSignupClient {
  const appId = process.env.WHATSAPP_APP_ID;
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (appId && appSecret)
    return createMetaSignupClient({
      appId,
      appSecret,
      fetch: whatsAppTestVendorFetch(),
    });
  const unavailable = async (): Promise<never> => {
    throw new MetaSignupError("unconfigured");
  };
  return {
    exchangeCode: unavailable,
    validateNumber: unavailable,
    subscribe: unavailable,
    register: unavailable,
    readReadiness: unavailable,
  };
}

const debugSchema = z.object({
  data: z.object({
    is_valid: z.boolean(),
    app_id: z.string(),
    expires_at: z.number().nonnegative(),
    data_access_expires_at: z.number().nonnegative().optional(),
    granular_scopes: z
      .array(
        z.object({
          scope: z.string(),
          target_ids: z.array(z.string()).optional(),
        }),
      )
      .optional(),
  }),
});

/** Direct Cloud API onboarding: no Solution Partner or shared system token. */
export function createMetaSignupClient({
  appId,
  appSecret,
  fetch: fetcher = fetch,
}: {
  appId: string;
  appSecret: string;
  fetch?: typeof fetch;
}): MetaSignupClient {
  const base = `https://graph.facebook.com/${whatsappApiVersion()}`;
  async function request(
    path: string,
    token: string,
    body?: Record<string, string>,
  ): Promise<unknown> {
    try {
      const response = await fetcher(`${base}/${path}`, {
        method: body ? "POST" : "GET",
        headers: { Authorization: `Bearer ${token}` },
        body: body ? new URLSearchParams(body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new MetaSignupError("signup_failed");
      return await response.json();
    } catch {
      // Fetch/JSON errors can contain a URL carrying the exchange code or token.
      throw new MetaSignupError("signup_failed");
    }
  }
  async function debug(token: string) {
    const parsed = debugSchema.safeParse(
      await request(
        `debug_token?input_token=${encodeURIComponent(token)}`,
        `${appId}|${appSecret}`,
      ),
    );
    if (
      !parsed.success ||
      !parsed.data.data.is_valid ||
      parsed.data.data.app_id !== appId
    )
      throw new MetaSignupError("invalid_assets");
    return parsed.data.data;
  }
  async function success(
    path: string,
    token: string,
    body: Record<string, string>,
  ) {
    if (
      !z
        .object({ success: z.literal(true) })
        .safeParse(await request(path, token, body)).success
    )
      throw new MetaSignupError("signup_failed");
  }
  return {
    async readReadiness({ token, wabaId, phoneNumberId }) {
      // Embedded Signup's waba_id is the Messaging Account ID during Meta's
      // H2 2026 rollout. Funding belongs to that account, not the phone number.
      // https://developers.facebook.com/documentation/business-messaging/whatsapp/account-model-evolution/onboarding/
      const [phoneResponse, fundingResponse] = await Promise.all([
        request(`${phoneNumberId}?fields=status,verified_name`, token),
        request(`${wabaId}?fields=primary_funding_id`, token),
      ]);
      const phone = z
        .object({
          status: z.string(),
          verified_name: z.string().trim().min(1).optional(),
        })
        .safeParse(phoneResponse);
      const funding = z
        .object({ primary_funding_id: z.string().min(1).nullish() })
        .safeParse(fundingResponse);
      if (!phone.success || !funding.success)
        throw new MetaSignupError("signup_failed");
      return {
        registered: phone.data.status === "CONNECTED",
        paymentMethod: !!funding.data.primary_funding_id,
        profileName: phone.data.verified_name ?? null,
      };
    },
    async exchangeCode(code) {
      const result = z.object({ access_token: z.string().min(1) }).safeParse(
        await request("oauth/access_token", `${appId}|${appSecret}`, {
          client_id: appId,
          client_secret: appSecret,
          code,
        }),
      );
      if (!result.success) throw new MetaSignupError("signup_failed");
      const token = result.data.access_token;
      const inspected = await debug(token);
      const expiries = [
        inspected.expires_at,
        inspected.data_access_expires_at ?? 0,
      ].filter((value) => value > 0);
      return {
        token,
        expiresAt: expiries.length
          ? new Date(Math.min(...expiries) * 1000)
          : null,
      };
    },
    async validateNumber({ token, wabaId, phoneNumberId, number }) {
      const inspected = await debug(token);
      if (
        !inspected.granular_scopes?.some(
          (scope) =>
            scope.scope === "whatsapp_business_management" &&
            scope.target_ids?.includes(wabaId),
        )
      )
        return false;
      const phones = z
        .object({
          data: z.array(
            z.object({ id: z.string(), display_phone_number: z.string() }),
          ),
        })
        .safeParse(
          await request(
            `${wabaId}/phone_numbers?fields=id,display_phone_number&limit=100`,
            token,
          ),
        );
      if (!phones.success) throw new MetaSignupError("signup_failed");
      return phones.data.data.some(
        (phone) =>
          phone.id === phoneNumberId &&
          `+${phone.display_phone_number.replace(/\D/g, "")}` === number,
      );
    },
    subscribe: ({ token, wabaId }) =>
      success(`${wabaId}/subscribed_apps`, token, {}),
    register: ({ token, phoneNumberId, pin }) =>
      success(`${phoneNumberId}/register`, token, {
        messaging_product: "whatsapp",
        pin,
      }),
  };
}

import { z } from "zod";
import { whatsappApiVersion } from "./config";
import { whatsAppTestVendorFetch } from "./test-vendor-fetch";
