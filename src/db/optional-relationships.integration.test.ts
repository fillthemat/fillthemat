import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { authSql, loadLocalEnv, requireRow } from "@/test/integration-env";

loadLocalEnv();
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl).hostname)) {
  throw new Error("Optional relationship tests require a local database");
}
const sql = authSql();
afterAll(() => sql.end({ timeout: 5 }));

it.each([
  ["conversations", "landing_session_id", "landing_sessions", "contact_id"],
  ["conversations", "contact_id", "contacts", "landing_session_id"],
  ["leads", "trial_offering_id", "trial_offerings", "contact_id"],
  ["bookings", "conversation_id", "conversations", "landing_session_id"],
  ["bookings", "landing_session_id", "landing_sessions", "conversation_id"],
] as const)(
  "%s.%s clears only the optional ID when its referenced row is deleted",
  async (table, column, parentTable, retainedColumn) => {
    const rollback = new Error("Roll back relationship fixtures");
    await expect(
      sql.begin(async (tx) => {
        const ownerId = randomUUID();
        const schoolId = randomUUID();
        const contactId = randomUUID();
        const sessionId = randomUUID();
        const conversationId = randomUUID();
        const offeringId = randomUUID();
        const childId = table === "conversations" ? conversationId : randomUUID();
        await tx`insert into auth.users (id) values (${ownerId})`;
        await tx`insert into public.users (id, email) values (${ownerId}, ${`${ownerId}@local.test`})`;
        await tx`
          insert into public.schools (id, owner_user_id, slug, name, timezone, notification_email)
          values (${schoolId}, ${ownerId}, ${`fk-${schoolId}`}, 'FK regression', 'UTC', 'fk@local.test')
        `;
        await tx`
          insert into public.contacts (id, school_id, name, phone)
          values (${contactId}, ${schoolId}, 'Contact', '16505550123')
        `;
        await tx`
          insert into public.landing_sessions (id, school_id, session_key_hash)
          values (${sessionId}, ${schoolId}, ${randomUUID()})
        `;
        await tx`
          insert into public.conversations (id, school_id, landing_session_id, contact_id, resume_token_hash, expires_at)
          values (${conversationId}, ${schoolId}, ${sessionId}, ${contactId}, ${randomUUID()}, now() + interval '1 day')
        `;
        if (table !== "conversations") {
          await tx`
            insert into public.trial_offerings (id, school_id, name)
            values (${offeringId}, ${schoolId}, 'Trial')
          `;
        }
        if (table === "leads") {
          await tx`
            insert into public.leads (id, school_id, landing_session_id, contact_id, trial_offering_id)
            values (${childId}, ${schoolId}, ${sessionId}, ${contactId}, ${offeringId})
          `;
        }
        if (table === "bookings") {
          const participantId = randomUUID();
          const windowId = randomUUID();
          const occurrenceId = randomUUID();
          await tx`
            insert into public.participants (id, school_id, contact_id, name, normalized_name)
            values (${participantId}, ${schoolId}, ${contactId}, 'Participant', 'participant')
          `;
          await tx`
            insert into public.trial_windows (id, school_id, trial_offering_id, day_of_week, start_minute, duration_minutes, capacity)
            values (${windowId}, ${schoolId}, ${offeringId}, 1, 600, 60, 8)
          `;
          await tx`
            insert into public.trial_occurrences (id, school_id, trial_window_id, trial_offering_id, start_at, end_at, capacity)
            values (${occurrenceId}, ${schoolId}, ${windowId}, ${offeringId}, now() + interval '1 day', now() + interval '25 hours', 8)
          `;
          await tx`
            insert into public.bookings (
              id, school_id, contact_id, participant_id, trial_offering_id, trial_window_id, trial_occurrence_id,
              conversation_id, landing_session_id, idempotency_key, participant_name_snapshot, participant_age_snapshot,
              offering_name_snapshot, timezone_snapshot, start_at, end_at, contact_name_snapshot, contact_phone_snapshot, ics_uid
            ) values (
              ${childId}, ${schoolId}, ${contactId}, ${participantId}, ${offeringId}, ${windowId}, ${occurrenceId},
              ${conversationId}, ${sessionId}, ${randomUUID()}, 'Participant', 18,
              'Trial', 'UTC', now() + interval '1 day', now() + interval '25 hours', 'Contact', '16505550123', ${randomUUID()}
            )
          `;
        }
        const child = tx(`public.${table}`);
        const [row] = await tx`
          select school_id, ${tx(column)} as optional_id, ${tx(retainedColumn)} as retained_id
          from ${child} where id = ${childId}
        `;
        const before = requireRow(row, "child before deletion");
        expect(before.school_id).toBe(schoolId);
        expect(before.optional_id).not.toBeNull();
        expect(before.retained_id).not.toBeNull();

        await tx`delete from ${tx(`public.${parentTable}`)} where id = ${before.optional_id}`;

        const [after] = await tx`
          select school_id, ${tx(column)} as optional_id, ${tx(retainedColumn)} as retained_id
          from ${child} where id = ${childId}
        `;
        expect(after).toEqual({
          school_id: schoolId,
          optional_id: null,
          retained_id: before.retained_id,
        });
        // Roll back even on success: no fixtures persist in the shared local stack.
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  },
);
