import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const appSchema = pgSchema("app");
export type TerminalCause = "permanent" | "attempts_exhausted" | "stale";

export const bookingStatusEnum = appSchema.enum("booking_status", [
  "booked",
  "showed",
  "no_show",
  "cancelled",
]);

export const emailKindEnum = appSchema.enum("email_kind", [
  "prospect_confirmation",
  "booking_reminder",
  "booking_cancellation",
  "owner_booking",
  "owner_cancellation",
  "owner_lead",
  "owner_whatsapp_confirmation_failed",
]);

export const emailStateEnum = appSchema.enum("email_state", [
  "pending",
  "claimed",
  "sent",
  "failed",
  "delivered",
  "bounced",
  "complained",
  "dead",
]);

export const whatsappDeliveryStateEnum = appSchema.enum(
  "whatsapp_delivery_state",
  ["pending", "claimed", "sent", "delivered", "read", "failed", "dead"],
);

export const whatsappJobStateEnum = appSchema.enum("whatsapp_job_state", [
  "pending",
  "claimed",
  "done",
  "failed",
  "dead",
]);

export const whatsappBookingIntentStateEnum = appSchema.enum(
  "whatsapp_booking_intent_state",
  ["pending", "confirmed", "expired", "superseded"],
);

export const messageCompletionEnum = appSchema.enum("message_completion", [
  "complete",
  "streaming",
  "aborted",
  "error",
]);

export const conversationEndReasonEnum = appSchema.enum(
  "conversation_end_reason",
  ["inactivity", "message_limit"],
);

export const cronResultEnum = appSchema.enum("cron_result", [
  "success",
  "error",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const users = appSchema.table("users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name"),
  ...timestamps,
});

export const schools = appSchema.table(
  "schools",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    timezone: text("timezone").notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    previewedAt: timestamp("previewed_at", { withTimezone: true }),
    notificationEmail: text("notification_email").notNull(),
    whatsappPhoneNumberId: text("whatsapp_phone_number_id"),
    whatsappWabaId: text("whatsapp_waba_id"),
    phone: text("phone"),
    website: text("website"),
    address: text("address"),
    country: text("country").notNull().default("US"),
    city: text("city"),
    parkingNotes: text("parking_notes"),
    accessNotes: text("access_notes"),
    trialGuidance: text("trial_guidance"),
    pricing: text("pricing"),
    welcomeMessage: text("welcome_message"),
    agentInstructions: text("agent_instructions"),
    logoUrl: text("logo_url"),
    primaryColor: text("primary_color"),
    ...timestamps,
  },
  (t) => [
    unique("schools_owner_user_id_unique").on(t.ownerUserId),
    unique("schools_slug_unique").on(t.slug),
    unique("schools_school_id_unique").on(t.id),
    uniqueIndex("schools_whatsapp_phone_number_id_unique")
      .on(t.whatsappPhoneNumberId)
      .where(sql`${t.whatsappPhoneNumberId} IS NOT NULL`),
    check(
      "schools_slug_format",
      sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(${t.slug}) BETWEEN 3 AND 48`,
    ),
    check(
      "schools_primary_color",
      sql`${t.primaryColor} IS NULL OR ${t.primaryColor} ~ '^#[0-9A-Fa-f]{6}$'`,
    ),
    check(
      "schools_logo_url",
      sql`${t.logoUrl} IS NULL OR ${t.logoUrl} ~ '^https://'`,
    ),
  ],
);

export const faqs = appSchema.table(
  "faqs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id").notNull(),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    unique("faqs_school_id_id").on(t.schoolId, t.id),
    foreignKey({
      columns: [t.schoolId],
      foreignColumns: [schools.id],
      name: "faqs_school_id_fk",
    }).onDelete("cascade"),
    check(
      "faqs_question_len",
      sql`char_length(${t.question}) BETWEEN 1 AND 200`,
    ),
    check("faqs_answer_len", sql`char_length(${t.answer}) BETWEEN 1 AND 2000`),
  ],
);

export const trialOfferings = appSchema.table(
  "trial_offerings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    minimumAge: integer("minimum_age"),
    maximumAge: integer("maximum_age"),
    expectations: text("expectations"),
    attire: text("attire"),
    waiverNotes: text("waiver_notes"),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    unique("trial_offerings_school_id_id").on(t.schoolId, t.id),
    foreignKey({
      columns: [t.schoolId],
      foreignColumns: [schools.id],
      name: "trial_offerings_school_id_fk",
    }).onDelete("cascade"),
    check(
      "trial_offerings_age_range",
      sql`(${t.minimumAge} IS NULL OR ${t.minimumAge} BETWEEN 0 AND 99)
        AND (${t.maximumAge} IS NULL OR ${t.maximumAge} BETWEEN 0 AND 99)
        AND (${t.minimumAge} IS NULL OR ${t.maximumAge} IS NULL OR ${t.minimumAge} <= ${t.maximumAge})`,
    ),
    check(
      "trial_offerings_name_len",
      sql`char_length(${t.name}) BETWEEN 1 AND 80`,
    ),
  ],
);

export const trialWindows = appSchema.table(
  "trial_windows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id").notNull(),
    trialOfferingId: uuid("trial_offering_id").notNull(),
    dayOfWeek: integer("day_of_week").notNull(),
    startMinute: integer("start_minute").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    capacity: integer("capacity").notNull(),
    label: text("label"),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    unique("trial_windows_school_id_id").on(t.schoolId, t.id),
    foreignKey({
      columns: [t.schoolId],
      foreignColumns: [schools.id],
      name: "trial_windows_school_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.schoolId, t.trialOfferingId],
      foreignColumns: [trialOfferings.schoolId, trialOfferings.id],
      name: "trial_windows_offering_fk",
    }).onDelete("cascade"),
    check("trial_windows_day", sql`${t.dayOfWeek} BETWEEN 0 AND 6`),
    check(
      "trial_windows_start_minute",
      sql`${t.startMinute} BETWEEN 0 AND 1439`,
    ),
    check("trial_windows_duration", sql`${t.durationMinutes} > 0`),
    check("trial_windows_capacity", sql`${t.capacity} BETWEEN 1 AND 50`),
  ],
);

export const trialOccurrences = appSchema.table(
  "trial_occurrences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id").notNull(),
    trialWindowId: uuid("trial_window_id").notNull(),
    trialOfferingId: uuid("trial_offering_id").notNull(),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    capacity: integer("capacity").notNull(),
    bookedCount: integer("booked_count").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    unique("trial_occurrences_school_id_id").on(t.schoolId, t.id),
    unique("trial_occurrences_window_start").on(t.trialWindowId, t.startAt),
    foreignKey({
      columns: [t.schoolId],
      foreignColumns: [schools.id],
      name: "trial_occurrences_school_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.schoolId, t.trialWindowId],
      foreignColumns: [trialWindows.schoolId, trialWindows.id],
      name: "trial_occurrences_window_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.schoolId, t.trialOfferingId],
      foreignColumns: [trialOfferings.schoolId, trialOfferings.id],
      name: "trial_occurrences_offering_fk",
    }).onDelete("restrict"),
    check(
      "trial_occurrences_booked_count",
      sql`${t.bookedCount} >= 0 AND ${t.bookedCount} <= ${t.capacity}`,
    ),
    check("trial_occurrences_capacity", sql`${t.capacity} BETWEEN 1 AND 50`),
    check("trial_occurrences_range", sql`${t.endAt} > ${t.startAt}`),
  ],
);

export const contacts = appSchema.table(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id").notNull(),
    email: text("email"),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    ...timestamps,
  },
  (t) => [
    unique("contacts_school_id_id").on(t.schoolId, t.id),
    unique("contacts_school_email").on(t.schoolId, t.email),
    unique("contacts_school_phone").on(t.schoolId, t.phone),
    foreignKey({
      columns: [t.schoolId],
      foreignColumns: [schools.id],
      name: "contacts_school_id_fk",
    }).onDelete("cascade"),
  ],
);

export const participants = appSchema.table(
  "participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    ...timestamps,
  },
  (t) => [
    unique("participants_school_id_id").on(t.schoolId, t.id),
    unique("participants_contact_normalized_name").on(
      t.contactId,
      t.normalizedName,
    ),
    foreignKey({
      columns: [t.schoolId],
      foreignColumns: [schools.id],
      name: "participants_school_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.schoolId, t.contactId],
      foreignColumns: [contacts.schoolId, contacts.id],
      name: "participants_contact_fk",
    }).onDelete("cascade"),
  ],
);

export const landingSessions = appSchema.table(
  "landing_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id").notNull(),
    sessionKeyHash: text("session_key_hash").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    qualifiedAt: timestamp("qualified_at", { withTimezone: true }),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    utmContent: text("utm_content"),
    utmTerm: text("utm_term"),
    isPreview: boolean("is_preview").notNull().default(false),
    botExclusionReason: text("bot_exclusion_reason"),
    ...timestamps,
  },
  (t) => [
    unique("landing_sessions_school_id_id").on(t.schoolId, t.id),
    unique("landing_sessions_school_key").on(t.schoolId, t.sessionKeyHash),
    foreignKey({
      columns: [t.schoolId],
      foreignColumns: [schools.id],
      name: "landing_sessions_school_id_fk",
    }).onDelete("cascade"),
  ],
);

export const conversations = appSchema.table(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id").notNull(),
    landingSessionId: uuid("landing_session_id"),
    contactId: uuid("contact_id"),
    resumeTokenHash: text("resume_token_hash").notNull(),
    waIdHash: text("wa_id_hash"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    generatingAt: timestamp("generating_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endReason: conversationEndReasonEnum("end_reason"),
    ...timestamps,
  },
  (t) => [
    unique("conversations_school_id_id").on(t.schoolId, t.id),
    uniqueIndex("conversations_resume_token_hash")
      .on(t.resumeTokenHash)
      .where(sql`${t.endedAt} IS NULL`),
    uniqueIndex("conversations_school_wa_id_hash")
      .on(t.schoolId, t.waIdHash)
      .where(sql`${t.waIdHash} IS NOT NULL AND ${t.endedAt} IS NULL`),
    foreignKey({
      columns: [t.schoolId],
      foreignColumns: [schools.id],
      name: "conversations_school_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.schoolId, t.landingSessionId],
      foreignColumns: [landingSessions.schoolId, landingSessions.id],
      name: "conversations_landing_session_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [t.schoolId, t.contactId],
      foreignColumns: [contacts.schoolId, contacts.id],
      name: "conversations_contact_fk",
    }).onDelete("set null"),
  ],
);

export const messages = appSchema.table(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references((): AnyPgColumn => conversations.id, { onDelete: "cascade" }),
    messageId: text("message_id").notNull(),
    role: text("role").notNull(),
    parts: jsonb("parts").notNull().$type<unknown>(),
    completion: messageCompletionEnum("completion")
      .notNull()
      .default("complete"),
    ...timestamps,
  },
  (t) => [
    unique("messages_conversation_message_id").on(
      t.conversationId,
      t.messageId,
    ),
  ],
);

export const leads = appSchema.table(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id").notNull(),
    landingSessionId: uuid("landing_session_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    participantName: text("participant_name"),
    participantAge: integer("participant_age"),
    trialOfferingId: uuid("trial_offering_id"),
    statedNeed: text("stated_need"),
    status: text("status").notNull().default("open"),
    ...timestamps,
  },
  (t) => [
    unique("leads_school_id_id").on(t.schoolId, t.id),
    foreignKey({
      columns: [t.schoolId],
      foreignColumns: [schools.id],
      name: "leads_school_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.schoolId, t.landingSessionId],
      foreignColumns: [landingSessions.schoolId, landingSessions.id],
      name: "leads_landing_session_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.schoolId, t.contactId],
      foreignColumns: [contacts.schoolId, contacts.id],
      name: "leads_contact_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.schoolId, t.trialOfferingId],
      foreignColumns: [trialOfferings.schoolId, trialOfferings.id],
      name: "leads_offering_fk",
    }).onDelete("set null"),
  ],
);

export const bookings = appSchema.table(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    participantId: uuid("participant_id").notNull(),
    trialOfferingId: uuid("trial_offering_id").notNull(),
    trialWindowId: uuid("trial_window_id").notNull(),
    trialOccurrenceId: uuid("trial_occurrence_id").notNull(),
    conversationId: uuid("conversation_id"),
    landingSessionId: uuid("landing_session_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    status: bookingStatusEnum("status").notNull().default("booked"),
    participantNameSnapshot: text("participant_name_snapshot").notNull(),
    participantAgeSnapshot: integer("participant_age_snapshot").notNull(),
    offeringNameSnapshot: text("offering_name_snapshot").notNull(),
    timezoneSnapshot: text("timezone_snapshot").notNull(),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    locationSnapshot: text("location_snapshot"),
    instructionsSnapshot: text("instructions_snapshot"),
    contactEmailSnapshot: text("contact_email_snapshot"),
    contactNameSnapshot: text("contact_name_snapshot").notNull(),
    contactPhoneSnapshot: text("contact_phone_snapshot").notNull(),
    icsUid: text("ics_uid").notNull(),
    icsSequence: integer("ics_sequence").notNull().default(0),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("bookings_school_id_id").on(t.schoolId, t.id),
    unique("bookings_school_idempotency").on(t.schoolId, t.idempotencyKey),
    uniqueIndex("bookings_active_participant_occurrence")
      .on(t.trialOccurrenceId, t.participantId)
      .where(sql`${t.status} <> 'cancelled'`),
    foreignKey({
      columns: [t.schoolId],
      foreignColumns: [schools.id],
      name: "bookings_school_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.schoolId, t.contactId],
      foreignColumns: [contacts.schoolId, contacts.id],
      name: "bookings_contact_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.schoolId, t.participantId],
      foreignColumns: [participants.schoolId, participants.id],
      name: "bookings_participant_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.schoolId, t.trialOfferingId],
      foreignColumns: [trialOfferings.schoolId, trialOfferings.id],
      name: "bookings_offering_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.schoolId, t.trialWindowId],
      foreignColumns: [trialWindows.schoolId, trialWindows.id],
      name: "bookings_window_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.schoolId, t.trialOccurrenceId],
      foreignColumns: [trialOccurrences.schoolId, trialOccurrences.id],
      name: "bookings_occurrence_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.schoolId, t.conversationId],
      foreignColumns: [conversations.schoolId, conversations.id],
      name: "bookings_conversation_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [t.schoolId, t.landingSessionId],
      foreignColumns: [landingSessions.schoolId, landingSessions.id],
      name: "bookings_landing_session_fk",
    }).onDelete("set null"),
    check(
      "bookings_participant_age",
      sql`${t.participantAgeSnapshot} BETWEEN 0 AND 99`,
    ),
  ],
);

export const emailDeliveries = appSchema.table(
  "email_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id").notNull(),
    bookingId: uuid("booking_id"),
    leadId: uuid("lead_id"),
    kind: emailKindEnum("kind").notNull(),
    recipient: text("recipient").notNull(),
    providerIdempotencyKey: text("provider_idempotency_key").notNull(),
    state: emailStateEnum("state").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    providerId: text("provider_id"),
    lastError: text("last_error"),
    failureReason: text("failure_reason"),
    terminalCause: text("terminal_cause").$type<TerminalCause>(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimedBy: text("claimed_by"),
    ...timestamps,
  },
  (t) => [
    unique("email_deliveries_provider_key").on(t.providerIdempotencyKey),
    index("email_deliveries_due_idx").on(t.state, t.nextAttemptAt),
    foreignKey({
      columns: [t.schoolId],
      foreignColumns: [schools.id],
      name: "email_deliveries_school_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.schoolId, t.bookingId],
      foreignColumns: [bookings.schoolId, bookings.id],
      name: "email_deliveries_booking_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.schoolId, t.leadId],
      foreignColumns: [leads.schoolId, leads.id],
      name: "email_deliveries_lead_fk",
    }).onDelete("cascade"),
  ],
);

export const whatsappDeliveries = appSchema.table(
  "whatsapp_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id").notNull(),
    bookingId: uuid("booking_id"),
    leadId: uuid("lead_id"),
    recipientWaId: text("recipient_wa_id").notNull(),
    phoneNumberId: text("phone_number_id").notNull(),
    providerIdempotencyKey: text("provider_idempotency_key").notNull(),
    state: whatsappDeliveryStateEnum("state").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    providerId: text("provider_id"),
    templateName: text("template_name"),
    templateParams: jsonb("template_params").$type<unknown>(),
    body: text("body"),
    interactiveButtons: jsonb("interactive_buttons").$type<Array<{
      id: string;
      title: string;
    }> | null>(),
    windowExpiresAt: timestamp("window_expires_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    statusAt: timestamp("status_at", { withTimezone: true }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimedBy: text("claimed_by"),
    lastError: text("last_error"),
    failureReason: text("failure_reason"),
    failureCode: integer("failure_code"),
    terminalCause: text("terminal_cause").$type<TerminalCause>(),
    ...timestamps,
  },
  (t) => [
    unique("whatsapp_deliveries_provider_key").on(t.providerIdempotencyKey),
    index("whatsapp_deliveries_due_idx").on(t.state, t.nextAttemptAt),
    foreignKey({
      columns: [t.schoolId],
      foreignColumns: [schools.id],
      name: "whatsapp_deliveries_school_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.schoolId, t.bookingId],
      foreignColumns: [bookings.schoolId, bookings.id],
      name: "whatsapp_deliveries_booking_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.schoolId, t.leadId],
      foreignColumns: [leads.schoolId, leads.id],
      name: "whatsapp_deliveries_lead_fk",
    }).onDelete("cascade"),
  ],
);

export const whatsappJobs = appSchema.table(
  "whatsapp_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id"),
    phoneNumberId: text("phone_number_id").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    kind: text("kind").notNull().default("inbound_message"),
    payload: jsonb("payload").notNull().$type<unknown>(),
    state: whatsappJobStateEnum("state").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimedBy: text("claimed_by"),
    lastError: text("last_error"),
    failureReason: text("failure_reason"),
    terminalCause: text("terminal_cause").$type<TerminalCause>(),
    ...timestamps,
  },
  (t) => [
    unique("whatsapp_jobs_dedupe_key").on(t.dedupeKey),
    index("whatsapp_jobs_due_idx").on(t.state, t.nextAttemptAt),
    foreignKey({
      columns: [t.schoolId],
      foreignColumns: [schools.id],
      name: "whatsapp_jobs_school_id_fk",
    }).onDelete("set null"),
  ],
);

export const whatsappBookingIntents = appSchema.table(
  "whatsapp_booking_intents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    offeringId: uuid("offering_id").notNull(),
    slotId: text("slot_id").notNull(),
    participantName: text("participant_name"),
    participantAge: integer("participant_age"),
    state: whatsappBookingIntentStateEnum("state").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [
    unique("whatsapp_booking_intents_school_id_id").on(t.schoolId, t.id),
    uniqueIndex("whatsapp_booking_intents_active_pending")
      .on(t.conversationId)
      .where(sql`${t.state} = 'pending'`),
    foreignKey({
      columns: [t.schoolId],
      foreignColumns: [schools.id],
      name: "whatsapp_booking_intents_school_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.schoolId, t.conversationId],
      foreignColumns: [conversations.schoolId, conversations.id],
      name: "whatsapp_booking_intents_conversation_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.schoolId, t.offeringId],
      foreignColumns: [trialOfferings.schoolId, trialOfferings.id],
      name: "whatsapp_booking_intents_offering_fk",
    }).onDelete("cascade"),
    check(
      "whatsapp_booking_intents_age",
      sql`${t.participantAge} IS NULL OR ${t.participantAge} BETWEEN 0 AND 99`,
    ),
  ],
);

export const funnelEvents = appSchema.table(
  "funnel_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id").notNull(),
    landingSessionId: uuid("landing_session_id"),
    conversationId: uuid("conversation_id"),
    bookingId: uuid("booking_id"),
    leadId: uuid("lead_id"),
    eventType: text("event_type").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("funnel_events_school_created_idx").on(t.schoolId, t.createdAt),
    foreignKey({
      columns: [t.schoolId],
      foreignColumns: [schools.id],
      name: "funnel_events_school_id_fk",
    }).onDelete("cascade"),
  ],
);

export const cronRuns = appSchema.table("cron_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  reminderCount: integer("reminder_count").notNull().default(0),
  sentCount: integer("sent_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  endedConversationCount: integer("ended_conversation_count")
    .notNull()
    .default(0),
  result: cronResultEnum("result"),
  errorSummary: text("error_summary"),
});

export type User = typeof users.$inferSelect;
export type School = typeof schools.$inferSelect;
export type Faq = typeof faqs.$inferSelect;
export type TrialOffering = typeof trialOfferings.$inferSelect;
export type TrialWindow = typeof trialWindows.$inferSelect;
export type TrialOccurrence = typeof trialOccurrences.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type Participant = typeof participants.$inferSelect;
export type LandingSession = typeof landingSessions.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type EmailDelivery = typeof emailDeliveries.$inferSelect;
export type WhatsAppDelivery = typeof whatsappDeliveries.$inferSelect;
export type WhatsAppJob = typeof whatsappJobs.$inferSelect;
export type WhatsAppBookingIntent = typeof whatsappBookingIntents.$inferSelect;
export type FunnelEvent = typeof funnelEvents.$inferSelect;
export type CronRun = typeof cronRuns.$inferSelect;
