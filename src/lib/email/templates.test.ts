import { describe, expect, it } from "vitest";
import type { Booking, School } from "@/db/schema";
import {
  prospectCancellationEmail,
  prospectConfirmationEmail,
  prospectReminderEmail,
} from "./templates";

const now = new Date("2026-10-11T12:00:00Z");
const school: School = {
  id: "school",
  ownerUserId: "owner",
  slug: "tiger-dojo",
  name: "Tiger Dojo",
  timezone: "America/New_York",
  approvedAt: now,
  publishedAt: now,
  previewedAt: now,
  notificationEmail: "private@school.test",
  publicContactEmail: "hello@school.test",
  whatsappPhoneNumberId: null,
  whatsappWabaId: null,
  whatsappConnectionState: "off",
  whatsappNumber: null,
  whatsappProfileName: null,
  whatsappHealthUpdatedAt: null,
  whatsappProviderResourceId: null,
  whatsappAllocationId: null,
  phone: "+15125550100",
  website: null,
  address: null,
  country: "US",
  city: null,
  parkingNotes: null,
  accessNotes: null,
  trialGuidance: null,
  pricing: null,
  welcomeMessage: null,
  agentInstructions: null,
  logoUrl: null,
  primaryColor: null,
  createdAt: now,
  updatedAt: now,
};
const booking: Booking = {
  id: "booking",
  schoolId: school.id,
  contactId: "contact",
  participantId: "participant",
  trialOfferingId: "offering",
  trialWindowId: "window",
  trialOccurrenceId: "occurrence",
  conversationId: null,
  landingSessionId: null,
  idempotencyKey: "booking",
  status: "booked",
  participantNameSnapshot: "Sam",
  participantAgeSnapshot: 10,
  offeringNameSnapshot: "Kids trial",
  timezoneSnapshot: school.timezone,
  startAt: now,
  endAt: new Date("2026-10-11T13:00:00Z"),
  locationSnapshot: null,
  instructionsSnapshot: null,
  contactEmailSnapshot: "prospect@example.com",
  contactNameSnapshot: "Alex",
  contactPhoneSnapshot: "+15125550200",
  icsUid: "booking@fillthemat.com",
  icsSequence: 0,
  cancelledAt: null,
  createdAt: now,
  updatedAt: now,
};

describe.each([
  ["confirmation", prospectConfirmationEmail],
  ["reminder", prospectReminderEmail],
  ["cancellation", prospectCancellationEmail],
])("prospect %s email", (_kind, template) => {
  it("shares only the public contact email, never the private notification email", () => {
    const { text } = template(school, booking);
    expect(text).toContain("School email: hello@school.test");
    expect(text).toContain("School phone: +15125550100");
    expect(text).not.toContain("private@school.test");
  });
  it("omits unset public contacts without falling back to the private email", () => {
    const { text } = template(
      { ...school, publicContactEmail: null, phone: null },
      booking,
    );
    expect(text).not.toContain("School email:");
    expect(text).not.toContain("School phone:");
    expect(text).not.toContain("private@school.test");
  });
});
