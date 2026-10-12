import { addHours, subHours } from "date-fns";
import { describe, expect, it } from "vitest";
import { planWhatsAppDelivery, type WhatsappDeliveryPlan } from "./deliveries";

const now = new Date("2026-09-11T12:00:00Z");

describe("planWhatsAppDelivery", () => {
  it("retires an explicit legacy template even inside the window", () => {
    const plan = planWhatsAppDelivery(
      {
        templateName: "booking_confirmation",
        templateParams: ["Demo Dojo", "Sam"],
        windowExpiresAt: addHours(now, 2),
      },
      now,
    );
    expect(plan.type).toBe("template_retired");
  });

  it("sends free-form text while the 24h window is open", () => {
    const plan = planWhatsAppDelivery(
      {
        templateName: null,
        templateParams: null,
        windowExpiresAt: addHours(now, 1),
      },
      now,
    );
    expect(plan).toEqual({ type: "text" } satisfies WhatsappDeliveryPlan);
  });

  it("fails closed when the window is closed and no template is set", () => {
    const plan = planWhatsAppDelivery(
      {
        templateName: null,
        templateParams: null,
        windowExpiresAt: subHours(now, 1),
      },
      now,
    );
    expect(plan).toEqual({ type: "window_closed" });
  });

  it("never sends a legacy template outside the window", () => {
    const plan = planWhatsAppDelivery(
      {
        templateName: "booking_reminder",
        templateParams: ["Demo Dojo", "Sam", "Monday"],
        windowExpiresAt: subHours(now, 1),
      },
      now,
    );
    expect(plan.type).toBe("template_retired");
  });

  it("plans an interactive message while the window is open", () => {
    const plan = planWhatsAppDelivery(
      {
        templateName: null,
        templateParams: null,
        windowExpiresAt: addHours(now, 1),
        interactiveButtons: [
          { id: "confirm_booking:abc", title: "Confirm booking" },
          { id: "choose_another_time", title: "Choose another time" },
        ],
        body: "Ready to book?",
      },
      now,
    );
    expect(plan.type).toBe("interactive");
    if (plan.type === "interactive") {
      expect(plan.body).toBe("Ready to book?");
      expect(plan.buttons).toHaveLength(2);
    }
  });

  it("fails closed for an interactive message when the window is closed", () => {
    const plan = planWhatsAppDelivery(
      {
        templateName: null,
        templateParams: null,
        windowExpiresAt: subHours(now, 1),
        interactiveButtons: [
          { id: "confirm_booking:abc", title: "Confirm booking" },
        ],
        body: "Ready to book?",
      },
      now,
    );
    expect(plan.type).toBe("window_closed");
  });
});
