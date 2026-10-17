import { describe, expect, it } from "vitest";
import statusDelivered from "@/test/fixtures/whatsapp/status-delivered.json";
import textInbound from "@/test/fixtures/whatsapp/text-inbound.json";
import { parseInboundWhatsAppMessages } from "./parse";

describe("parseInboundWhatsAppMessages", () => {
  it("extracts a text inbound message", () => {
    const parsed = parseInboundWhatsAppMessages(textInbound);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      phoneNumberId: "106500000000000",
      wamid: "wamid.HBgLMjY1MDUSMTIzNDVBMUIx",
      waId: "16505551234",
      text: "Hi, is there a beginner trial this week?",
    });
  });

  it("returns an empty list for status payloads", () => {
    expect(parseInboundWhatsAppMessages(statusDelivered)).toHaveLength(0);
  });

  it("treats a non-array messages field as empty", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "106500000000000" },
                contacts: [{ wa_id: "16505551234" }],
                messages: "not-an-array",
              },
            },
          ],
        },
      ],
    };
    expect(parseInboundWhatsAppMessages(payload)).toHaveLength(0);
  });

  it("extracts an interactive button reply id as text", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "106500000000000" },
                contacts: [{ wa_id: "16505551234" }],
                messages: [
                  {
                    from: "16505551234",
                    id: "wamid.button",
                    type: "interactive",
                    interactive: {
                      type: "button_reply",
                      button_reply: { id: "confirm_booking:1" },
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(parseInboundWhatsAppMessages(payload)[0].text).toBe("confirm_booking:1");
  });
});
