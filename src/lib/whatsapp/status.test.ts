import { describe, expect, it } from "vitest";
import statusDelivered from "@/test/fixtures/whatsapp/status-delivered.json";
import statusFailed from "@/test/fixtures/whatsapp/status-failed.json";
import textInbound from "@/test/fixtures/whatsapp/text-inbound.json";
import { parseInboundWhatsAppStatuses } from "./status";

describe("parseInboundWhatsAppStatuses", () => {
  it("preserves structured failure details and subcode for the shared policy", () => {
    const parsed = parseInboundWhatsAppStatuses({
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  {
                    id: "wamid.details",
                    status: "failed",
                    timestamp: "1",
                    errors: [
                      {
                        code: 1,
                        error_subcode: 100,
                        message: "Send failed",
                        error_data: { details: "Invalid parameter" },
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(parsed[0]).toMatchObject({
      errorCode: "1",
      errorSubcode: 100,
      errorDetails: "Invalid parameter",
    });
  });
  it("extracts a delivered status", () => {
    const parsed = parseInboundWhatsAppStatuses(statusDelivered);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      status: "delivered",
      wamid: "wamid.HBgLMjY1MDUSMTIzNDVBMUIx",
      recipientId: "16505551234",
      timestamp: 1690000010,
    });
  });

  it("extracts a failed status with its error", () => {
    const parsed = parseInboundWhatsAppStatuses(statusFailed);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].status).toBe("failed");
    expect(parsed[0].errorCode).toBe("131026");
  });

  it("returns an empty list for inbound payloads", () => {
    expect(parseInboundWhatsAppStatuses(textInbound)).toHaveLength(0);
  });

  it("skips unknown status values", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [{ id: "wamid.1", status: "bogus", timestamp: "1" }],
              },
            },
          ],
        },
      ],
    };
    expect(parseInboundWhatsAppStatuses(payload)).toHaveLength(0);
  });
});
