import { z } from "zod";
import type { NumberProvider } from "./connection";
import { whatsAppTestVendorFetch } from "./test-vendor-fetch";

const usNumber = z.string().regex(/^\+1\d{10}$/);
const rentalSchema = z.object({
  phone_number: z.string(),
  sid: z.string().regex(/^PN[0-9a-fA-F]{32}$/),
  friendly_name: z.string().optional(),
});

/** Twilio's carrier API only; WhatsApp sends continue using direct Cloud API. */
export function createTwilioNumberProvider({
  accountSid,
  authToken,
  smsWebhookUrl,
  fetch: fetcher = fetch,
}: {
  accountSid: string;
  authToken: string;
  smsWebhookUrl: string;
  fetch?: typeof fetch;
}): NumberProvider {
  const base = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}`;
  const headers = {
    Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
  };
  async function request(url: string, body?: URLSearchParams) {
    return fetcher(url, {
      method: body ? "POST" : "GET",
      headers,
      body,
      signal: AbortSignal.timeout(15_000),
    });
  }
  return {
    async releaseNumber({ resourceId }) {
      if (!/^PN[0-9a-fA-F]{32}$/.test(resourceId))
        throw new Error("Invalid carrier resource");
      const response = await fetcher(
        `${base}/IncomingPhoneNumbers/${resourceId}.json`,
        {
          method: "DELETE",
          headers,
          signal: AbortSignal.timeout(15_000),
        },
      );
      // A lost DELETE response can be retried without releasing another rental.
      if (!response.ok && response.status !== 404)
        throw new Error("Carrier release failed");
    },
    async verificationMessageReceivedAt(messageId) {
      if (!/^SM[0-9a-fA-F]{32}$/.test(messageId)) return null;
      const response = await request(`${base}/Messages/${messageId}.json`);
      if (!response.ok) throw new Error("Carrier verification lookup failed");
      const message = z
        .object({
          sid: z.string(),
          account_sid: z.string(),
          date_created: z.string(),
        })
        .parse(await response.json());
      const receivedAt = new Date(message.date_created);
      return message.sid === messageId &&
        message.account_sid === accountSid &&
        Number.isFinite(receivedAt.getTime())
        ? receivedAt
        : null;
    },
    async buyUsNumber({ allocationId }) {
      const name = `fillthemat:${allocationId}`;
      // Reconcile a prior purchase before retrying the allocation. Do not
      // assume a timeout means no rental exists. The module serializes buys.
      let page: string | null =
        `${base}/IncomingPhoneNumbers.json?PageSize=1000`;
      while (page) {
        const response = await request(page);
        if (!response.ok) return { ok: false, code: "purchase_failed" };
        const rentals = z
          .object({
            incoming_phone_numbers: z.array(rentalSchema),
            next_page_uri: z.string().nullable(),
          })
          .parse(await response.json());
        const existing = rentals.incoming_phone_numbers.find(
          (rental) => rental.friendly_name === name,
        );
        if (existing)
          return {
            ok: true,
            number: usNumber.parse(existing.phone_number),
            resourceId: existing.sid,
          };
        page = rentals.next_page_uri
          ? new URL(rentals.next_page_uri, "https://api.twilio.com").href
          : null;
        if (page && !page.startsWith(`${base}/IncomingPhoneNumbers.json?`))
          throw new Error("Invalid carrier pagination");
      }
      const available = await request(
        `${base}/AvailablePhoneNumbers/US/Local.json?SmsEnabled=true&VoiceEnabled=true&PageSize=1`,
      );
      if (!available.ok) return { ok: false, code: "purchase_failed" };
      const inventory = z
        .object({
          available_phone_numbers: z.array(
            z.object({ phone_number: usNumber }),
          ),
        })
        .parse(await available.json());
      const number = inventory.available_phone_numbers[0]?.phone_number;
      if (!number) return { ok: false, code: "purchase_failed" };
      const purchased = await request(
        `${base}/IncomingPhoneNumbers.json`,
        new URLSearchParams({
          PhoneNumber: number,
          FriendlyName: name,
          SmsUrl: (() => {
            const url = new URL(smsWebhookUrl);
            url.searchParams.set("allocationId", allocationId);
            return url.href;
          })(),
          SmsMethod: "POST",
        }),
      );
      // Only a definite rejection is safe to retry automatically. An ambiguous
      // POST or an invalid success response leaves buying for reconciliation.
      if (purchased.status >= 400 && purchased.status < 500)
        return { ok: false, code: "purchase_failed" };
      if (!purchased.ok) throw new Error("Carrier purchase outcome unknown");
      const rental = rentalSchema.parse(await purchased.json());
      return {
        ok: true,
        number: usNumber.parse(rental.phone_number),
        resourceId: rental.sid,
      };
    },
  };
}

/** No credentials means a visible failed setup, never a pretend paid number. */
export function numberProviderFromEnv(): NumberProvider {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const smsWebhookUrl = process.env.TWILIO_SMS_WEBHOOK_URL;
  if (!accountSid || !authToken || !smsWebhookUrl) {
    return {
      async buyUsNumber() {
        return { ok: false, code: "unconfigured" };
      },
    };
  }
  return createTwilioNumberProvider({
    accountSid,
    authToken,
    smsWebhookUrl,
    fetch: whatsAppTestVendorFetch(),
  });
}
