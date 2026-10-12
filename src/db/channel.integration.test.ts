import { randomUUID } from "node:crypto";
import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, expect, it } from "vitest";
import { loadLocalEnv } from "@/test/integration-env";

loadLocalEnv();
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Missing local DATABASE_URL");
const localUrl = new URL(databaseUrl);
if (!["localhost", "127.0.0.1", "[::1]"].includes(localUrl.hostname)) {
  throw new Error("Channel migration tests require a local database");
}
const admin = postgres(localUrl.toString(), { max: 1 });
const databaseName = `channel_migration_${randomUUID().replaceAll("-", "")}`;
localUrl.pathname = `/${databaseName}`;
const fixture = postgres(localUrl.toString(), { max: 1 });
const migrations = readMigrationFiles({ migrationsFolder: "drizzle" });
const channelMigration = migrations.findIndex(({ sql }) =>
  sql.some((statement) => statement.includes('CREATE TYPE "app"."channel"')),
);
const ownerId = randomUUID();
const schoolId = randomUUID();
const contactId = randomUUID();
const offeringId = randomUUID();
const windowId = randomUUID();
const occurrenceId = randomUUID();
const webSession = randomUUID();
const whatsappSession = randomUUID();
const webConversation = randomUUID();
const whatsappConversation = randomUUID();

async function applyMigrations(from: number, to: number) {
  for (const migration of migrations.slice(from, to)) {
    await fixture.begin(async (tx) => {
      for (const statement of migration.sql) await tx.unsafe(statement);
    });
  }
}

beforeAll(async () => {
  // Isolate the pre-channel schema; never roll back the shared Supabase stack.
  await admin.unsafe(`create database "${databaseName}"`);
  await fixture`create schema auth`;
  await fixture`create table auth.users (id uuid primary key)`;
  if (channelMigration < 0) throw new Error("Missing Channel migration");
  await applyMigrations(0, channelMigration);
  await fixture`insert into auth.users (id) values (${ownerId})`;
  await fixture`insert into app.users (id, email) values (${ownerId}, 'owner@local.test')`;
  await fixture`insert into app.schools (id, owner_user_id, slug, name, timezone, notification_email) values (${schoolId}, ${ownerId}, 'channel-migration', 'Channel School', 'UTC', 'owner@local.test')`;
  await fixture`insert into app.contacts (id, school_id, name, phone) values (${contactId}, ${schoolId}, 'Contact', '16505550030')`;
  await fixture`insert into app.trial_offerings (id, school_id, name) values (${offeringId}, ${schoolId}, 'Trial')`;
  await fixture`insert into app.trial_windows (id, school_id, trial_offering_id, day_of_week, start_minute, duration_minutes, capacity) values (${windowId}, ${schoolId}, ${offeringId}, 1, 1080, 60, 10)`;
  await fixture`insert into app.trial_occurrences (id, school_id, trial_offering_id, trial_window_id, start_at, end_at, capacity) values (${occurrenceId}, ${schoolId}, ${offeringId}, ${windowId}, now(), now() + interval '1 hour', 10)`;
  await fixture`insert into app.landing_sessions (id, school_id, session_key_hash, utm_source) values (${webSession}, ${schoolId}, 'web', null), (${whatsappSession}, ${schoolId}, 'whatsapp-pseudo', 'whatsapp')`;
  await fixture`insert into app.conversations (id, school_id, resume_token_hash, wa_id_hash, expires_at) values (${webConversation}, ${schoolId}, 'web-resume', null, now() + interval '30 days'), (${whatsappConversation}, ${schoolId}, 'whatsapp-resume', 'wa-hash', now() + interval '30 days')`;
});

afterAll(async () => {
  await fixture.end({ timeout: 5 });
  // Only this test's random database is removed.
  await admin.unsafe(`drop database if exists "${databaseName}" with (force)`);
  await admin.end({ timeout: 5 });
});

it("backfills WhatsApp conversations and pseudo sessions, defaulting other bookings and leads to web", async () => {
  const cases = [
    { name: "direct", session: null, conversation: null, channel: "web" },
    {
      name: "web-chat",
      session: webSession,
      conversation: webConversation,
      channel: "web",
    },
    {
      name: "wa-chat",
      session: null,
      conversation: whatsappConversation,
      channel: "whatsapp",
    },
    {
      name: "wa-session",
      session: whatsappSession,
      conversation: null,
      channel: "whatsapp",
    },
  ];
  for (const row of cases) {
    const participantId = randomUUID();
    await fixture`insert into app.participants (id, school_id, contact_id, name, normalized_name) values (${participantId}, ${schoolId}, ${contactId}, ${row.name}, ${row.name})`;
    await fixture`insert into app.bookings (school_id, contact_id, participant_id, trial_offering_id, trial_window_id, trial_occurrence_id, conversation_id, landing_session_id, idempotency_key, participant_name_snapshot, participant_age_snapshot, offering_name_snapshot, timezone_snapshot, start_at, end_at, contact_name_snapshot, contact_phone_snapshot, ics_uid) values (${schoolId}, ${contactId}, ${participantId}, ${offeringId}, ${windowId}, ${occurrenceId}, ${row.conversation}, ${row.session}, ${randomUUID()}, ${row.name}, 8, 'Trial', 'UTC', now(), now() + interval '1 hour', 'Contact', '16505550030', ${randomUUID()})`;
  }
  await fixture`insert into app.leads (school_id, contact_id, landing_session_id, participant_name) values (${schoolId}, ${contactId}, ${webSession}, 'web-lead'), (${schoolId}, ${contactId}, ${whatsappSession}, 'wa-lead')`;
  await applyMigrations(channelMigration, migrations.length);
  expect(
    await fixture`select participant_name_snapshot as name, channel from app.bookings order by participant_name_snapshot`,
  ).toEqual([
    { name: "direct", channel: "web" },
    { name: "wa-chat", channel: "whatsapp" },
    { name: "wa-session", channel: "whatsapp" },
    { name: "web-chat", channel: "web" },
  ]);
  expect(
    await fixture`select participant_name as name, channel from app.leads order by participant_name`,
  ).toEqual([
    { name: "wa-lead", channel: "whatsapp" },
    { name: "web-lead", channel: "web" },
  ]);
});
