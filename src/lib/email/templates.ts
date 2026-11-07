import { formatInTimeZone } from "date-fns-tz";

/** Contact details included in transactional emails, independent of storage. */
export type EmailSchool = {
  name: string;
  phone: string | null;
  notificationEmail: string | null;
};

/** Immutable booking facts rendered by the templates. */
export type EmailBooking = {
  startAt: Date;
  timezoneSnapshot: string;
  offeringNameSnapshot: string;
  participantNameSnapshot: string;
  participantAgeSnapshot: number;
  locationSnapshot: string | null;
  instructionsSnapshot: string | null;
  contactNameSnapshot: string;
  contactEmailSnapshot: string | null;
  contactPhoneSnapshot: string;
};

export type EmailLead = {
  participantName: string | null;
  participantAge: number | null;
  statedNeed: string | null;
};

function formatWhen(booking: EmailBooking): string {
  return `${formatInTimeZone(
    booking.startAt,
    booking.timezoneSnapshot,
    "EEEE, MMMM d, yyyy 'at' h:mm a",
  )} (${booking.timezoneSnapshot})`;
}

function snapshotBlock(booking: EmailBooking): string {
  return [
    `School: details below`,
    `Offering: ${booking.offeringNameSnapshot}`,
    `Participant: ${booking.participantNameSnapshot} (age ${booking.participantAgeSnapshot})`,
    `When: ${formatWhen(booking)}`,
    booking.locationSnapshot ? `Where: ${booking.locationSnapshot}` : null,
    booking.instructionsSnapshot ? `What to know:\n${booking.instructionsSnapshot}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function prospectConfirmationEmail(school: EmailSchool, booking: EmailBooking) {
  const text = `You're booked for a trial class at ${school.name}.

${snapshotBlock(booking)}

${school.phone ? `School phone: ${school.phone}` : ""}
${school.notificationEmail ? `School email: ${school.notificationEmail}` : ""}

To cancel or reschedule, contact the school directly using the phone or email above. Do not reply to this message if it is unattended.

Fillthemat`;

  return {
    subject: `Trial class confirmed at ${school.name}`,
    text: text.replace(/\n{3,}/g, "\n\n").trim(),
  };
}

export function prospectReminderEmail(school: EmailSchool, booking: EmailBooking) {
  const date = formatInTimeZone(booking.startAt, booking.timezoneSnapshot, "EEEE, MMMM d");
  const text = `Reminder: ${booking.participantNameSnapshot}'s trial class at ${school.name} is on ${date}.

${snapshotBlock(booking)}

${school.phone ? `School phone: ${school.phone}` : ""}
${school.notificationEmail ? `School email: ${school.notificationEmail}` : ""}

Fillthemat`;

  return {
    subject: `Trial class reminder for ${date}`,
    text: text.replace(/\n{3,}/g, "\n\n").trim(),
  };
}

export function prospectCancellationEmail(school: EmailSchool, booking: EmailBooking) {
  const text = `Your trial class at ${school.name} has been cancelled.

${snapshotBlock(booking)}

If this is a surprise, contact the school.
${school.phone ? `School phone: ${school.phone}` : ""}
${school.notificationEmail ? `School email: ${school.notificationEmail}` : ""}

Fillthemat`;

  return {
    subject: `Trial class cancelled at ${school.name}`,
    text: text.replace(/\n{3,}/g, "\n\n").trim(),
  };
}

export function ownerBookingEmail(school: EmailSchool, booking: EmailBooking) {
  const text = `A trial class was booked at ${school.name}.

Contact: ${booking.contactNameSnapshot} <${booking.contactEmailSnapshot}> ${booking.contactPhoneSnapshot}
${snapshotBlock(booking)}

Fillthemat`;
  return {
    subject: `New trial booking: ${booking.participantNameSnapshot}`,
    text: text.trim(),
  };
}

export function ownerCancellationEmail(school: EmailSchool, booking: EmailBooking) {
  const text = `A trial class was cancelled at ${school.name}.

Contact: ${booking.contactNameSnapshot} <${booking.contactEmailSnapshot}>
${snapshotBlock(booking)}

Fillthemat`;
  return {
    subject: `Trial cancelled: ${booking.participantNameSnapshot}`,
    text: text.trim(),
  };
}

export function ownerWhatsAppConfirmationFailedEmail(school: EmailSchool, booking: EmailBooking) {
  return {
    subject: `Please contact ${booking.participantNameSnapshot} about their trial booking`,
    text: `We couldn't confirm this booking with ${booking.participantNameSnapshot} on WhatsApp. Please contact them to let them know they're booked at ${school.name}.

Contact: ${booking.contactNameSnapshot} ${booking.contactPhoneSnapshot}${booking.contactEmailSnapshot ? ` <${booking.contactEmailSnapshot}>` : ""}
Offering: ${booking.offeringNameSnapshot}
Participant: ${booking.participantNameSnapshot}
When: ${formatWhen(booking)}

Fillthemat`,
  };
}

export function ownerLeadEmail(
  school: EmailSchool,
  lead: EmailLead,
  contact: {
    name: string;
    email: string;
    phone: string;
  },
) {
  const text = `A prospect asked to be contacted because they could not book a trial at ${school.name}.

Contact: ${contact.name} <${contact.email}> ${contact.phone}
Participant: ${lead.participantName ?? "n/a"}${lead.participantAge != null ? ` (age ${lead.participantAge})` : ""}
Need: ${lead.statedNeed ?? "n/a"}

Fillthemat`;
  return {
    subject: `New trial lead at ${school.name}`,
    text: text.trim(),
  };
}
