import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  emailBookingQuotaExceeded,
  recipientQuotaExceeded,
  whatsappBookingQuotaExceeded,
  whatsappOutboundQuotaExceeded,
} from "./limits";

const client = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  gte: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => client }));

beforeEach(() => {
  vi.resetAllMocks();
  client.from.mockReturnValue(client);
  client.select.mockReturnValue(client);
  client.eq.mockReturnValue(client);
});

describe.each([
  [emailBookingQuotaExceeded, "bookings", "contact_email_snapshot", 6],
  [recipientQuotaExceeded, "email_deliveries", "recipient", 12],
  [whatsappBookingQuotaExceeded, "bookings", "contact_phone_snapshot", 6],
  [whatsappOutboundQuotaExceeded, "whatsapp_deliveries", "recipient_wa_id", 12],
] as const)("%s", (check, table, column, threshold) => {
  it.each([0, threshold - 1, threshold, threshold + 1])(
    "checks the exact count %i within the school, recipient and rolling day",
    async (count) => {
      client.gte.mockResolvedValue({ count, error: null });
      expect(await check("school", "recipient", new Date("2026-11-07T12:34:56Z"))).toBe(
        count >= threshold,
      );
      expect(client.from).toHaveBeenCalledWith(table);
      expect(client.select).toHaveBeenCalledWith("id", { count: "exact", head: true });
      expect(client.eq.mock.calls).toEqual([
        ["school_id", "school"],
        [column, "recipient"],
      ]);
      expect(client.gte).toHaveBeenCalledWith("created_at", "2026-11-06T12:34:56.000Z");
    },
  );

  it("propagates database failures rather than allowing activity", async () => {
    const error = { code: "08006", message: "unavailable" };
    client.gte.mockResolvedValue({ count: null, error });
    await expect(check("school", "recipient")).rejects.toBe(error);
  });
});
