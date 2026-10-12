import { z } from "zod";
import type { NumberProvider } from "./connection";
import { whatsAppTestVendorFetch } from "./test-vendor-fetch";

const usNumber = z.string().regex(/^\+1\d{10}$/);
const rentalSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  phoneNumber: usNumber,
  country: z.literal("US"),
  status: z.literal("active"),
  externalId: z.uuid(),
  agentId: z.string(),
});

/** AgentPhone supplies numbers only; WhatsApp sends use direct Cloud API. */
export function createAgentPhoneNumberProvider({
  apiKey,
  agentId,
  fetch: fetcher = fetch,
}: {
  apiKey: string;
  agentId: string;
  fetch?: typeof fetch;
}): NumberProvider {
  const base = "https://api.agentphone.ai/v1";
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  async function request(path: string, body?: object) {
    return fetcher(`${base}${path}`, {
      method: body ? "POST" : "GET",
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  }
  return {
    async verificationNumber(resourceId) {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(resourceId)) return null;
      const response = await request(`/numbers/${resourceId}`);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("Carrier number lookup failed");
      const rental = rentalSchema.safeParse(await response.json());
      return rental.success &&
        rental.data.id === resourceId &&
        rental.data.agentId === agentId
        ? {
            allocationId: rental.data.externalId,
            number: rental.data.phoneNumber,
          }
        : null;
    },
    async verificationCall(callId) {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(callId)) return null;
      const response = await request(`/calls/${callId}`);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("Carrier call lookup failed");
      const call = z
        .object({
          id: z.string(),
          agentId: z.string(),
          phoneNumberId: z.string(),
          toNumber: usNumber,
          direction: z.literal("inbound"),
          startedAt: z.iso.datetime({ offset: true }),
        })
        .safeParse(await response.json());
      return call.success &&
        call.data.id === callId &&
        call.data.agentId === agentId
        ? {
            receivedAt: new Date(call.data.startedAt),
            number: call.data.toNumber,
            resourceId: call.data.phoneNumberId,
          }
        : null;
    },
    async releaseNumber({ resourceId }) {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(resourceId))
        throw new Error("Invalid carrier resource");
      const response = await fetcher(`${base}/numbers/${resourceId}`, {
        method: "DELETE",
        headers,
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok && response.status !== 404)
        throw new Error("Carrier release failed");
    },
    async buyUsNumber({ allocationId, excludeNumber }) {
      z.uuid().parse(allocationId);
      // externalId is unique within the account. Always reconcile before a buy.
      // An ambiguous POST remains claimed by the connection module for support.
      const existing = await request(`/numbers?externalId=${allocationId}`);
      if (!existing.ok) return { ok: false, code: "purchase_failed" };
      const rentals = z
        .object({ data: z.array(rentalSchema), hasMore: z.boolean() })
        .parse(await existing.json());
      if (rentals.hasMore || rentals.data.length > 1)
        throw new Error("Carrier allocation is ambiguous");
      const result = (input: unknown) => {
        const rental = rentalSchema.parse(input);
        if (
          rental.externalId !== allocationId ||
          rental.agentId !== agentId ||
          rental.phoneNumber === excludeNumber
        )
          throw new Error("Carrier allocation mismatch");
        return {
          ok: true as const,
          number: rental.phoneNumber,
          resourceId: rental.id,
        };
      };
      if (rentals.data[0]) return result(rentals.data[0]);
      const purchased = await request("/numbers", {
        country: "US",
        type: "sms",
        agentId,
        externalId: allocationId,
      });
      if (purchased.status >= 400 && purchased.status < 500)
        return { ok: false, code: "purchase_failed" };
      if (!purchased.ok) throw new Error("Carrier purchase outcome unknown");
      return result(await purchased.json());
    },
  };
}

/** Missing credentials means a visible failed setup, never a pretend rental. */
export function numberProviderFromEnv(): NumberProvider {
  const apiKey = process.env.AGENTPHONE_API_KEY;
  const agentId = process.env.AGENTPHONE_VERIFICATION_AGENT_ID;
  const webhookSecret = process.env.AGENTPHONE_WEBHOOK_SECRET;
  if (!apiKey || !agentId || !webhookSecret) {
    return {
      async buyUsNumber() {
        return { ok: false, code: "unconfigured" };
      },
    };
  }
  return createAgentPhoneNumberProvider({
    apiKey,
    agentId,
    fetch: whatsAppTestVendorFetch(),
  });
}
