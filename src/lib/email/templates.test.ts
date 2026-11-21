import { describe, expect, it } from "vitest";
import {
  type EmailBooking,
  type EmailSchool,
  ownerBookingEmail,
  ownerCancellationEmail,
  ownerLeadEmail,
  ownerWhatsAppConfirmationFailedEmail,
  prospectCancellationEmail,
  prospectConfirmationEmail,
  prospectReminderEmail,
} from "./templates";

const school: EmailSchool = {
  name: "River Dojo",
  phone: "+1 555 123 4567",
  notificationEmail: "owner@example.com",
};
const booking: EmailBooking = {
  startAt: new Date("2026-11-09T15:00:00Z"),
  timezoneSnapshot: "America/New_York",
  offeringNameSnapshot: "Kids karate",
  participantNameSnapshot: "Alex",
  participantAgeSnapshot: 8,
  locationSnapshot: "12 River Road",
  instructionsSnapshot: "Wear comfortable clothes.\nArrive early.",
  contactNameSnapshot: "Sam",
  contactEmailSnapshot: "sam@example.com",
  contactPhoneSnapshot: "+1 555 987 6543",
};

describe("booking email templates", () => {
  for (const template of [
    prospectConfirmationEmail,
    prospectReminderEmail,
    prospectCancellationEmail,
    ownerBookingEmail,
    ownerCancellationEmail,
    ownerWhatsAppConfirmationFailedEmail,
  ]) {
    it(`${template.name} preserves the complete subject and body`, () => {
      expect(template(school, booking)).toMatchSnapshot();
    });
  }

  it("omits optional details", () => {
    const message = prospectConfirmationEmail(
      { ...school, phone: null, notificationEmail: null },
      {
        ...booking,
        locationSnapshot: null,
        instructionsSnapshot: null,
      },
    );
    expect(message).toMatchSnapshot();
    expect(message.text).not.toMatch(/Where:|What to know:|School phone:|School email:|\n{3}/);
  });

  for (const template of [ownerBookingEmail, ownerCancellationEmail]) {
    it(`${template.name} preserves the current missing contact email output`, () => {
      expect(template(school, { ...booking, contactEmailSnapshot: null })).toMatchSnapshot();
    });
  }

  it("omits a missing contact email from WhatsApp failure notifications", () => {
    expect(
      ownerWhatsAppConfirmationFailedEmail(school, { ...booking, contactEmailSnapshot: null }),
    ).toMatchSnapshot();
  });
});

describe("lead email template", () => {
  const contact = { name: "Sam", email: "sam@example.com", phone: "+1 555 987 6543" };

  it("renders participant and requested help", () => {
    expect(
      ownerLeadEmail(
        school,
        { participantName: "Alex", participantAge: 8, statedNeed: "A weekend class" },
        contact,
      ),
    ).toMatchSnapshot();
  });

  it("retains missing-detail fallbacks and includes age zero", () => {
    expect(
      ownerLeadEmail(
        school,
        { participantName: null, participantAge: null, statedNeed: null },
        contact,
      ),
    ).toMatchSnapshot();
    expect(
      ownerLeadEmail(
        school,
        { participantName: "Alex", participantAge: 0, statedNeed: null },
        contact,
      ).text,
    ).toContain("Participant: Alex (age 0)");
  });
});
