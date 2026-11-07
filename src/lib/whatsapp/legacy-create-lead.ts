import { and, eq, sql } from "drizzle-orm";
import type { CreateLeadInput } from "@/lib/leads/create-lead";
import { getDb, type Transaction, type TransactionOptions, withTransaction } from "@/db";
import { contacts, emailDeliveries, funnelEvents, landingSessions, leads } from "@/db/schema";
import { hashToken, hashWaId, normalizeEmail } from "@/lib/crypto";
import { FUNNEL_EVENTS } from "@/lib/funnel";

async function notificationEmail(schoolId: string, db: Pick<Transaction, "execute"> = getDb()) {
  const [settings] = await db.execute<{ notification_email: string }>(sql`
    select notification_email from public.school_settings where school_id = ${schoolId}
  `);
  if (!settings) throw new Error("School settings are missing");
  return settings.notification_email;
}

/**
 * Unchanged legacy write retained ONLY for the Drizzle WhatsApp Turn until #253.
 * Its school/offering/session IDs are not public IDs. Do not call the public RPC
 * with them or add a dual-write bridge. #253 replaces this with a SQL create_lead
 * call inside its public Turn transaction, then deletes this adapter.
 */
export async function createLegacyLead(input: CreateLeadInput, options: TransactionOptions = {}) {
  const email = input.contact.email ? normalizeEmail(input.contact.email) : null;

  const write = async (tx: Transaction) => {
    const contactValues = {
      schoolId: input.school.id,
      email,
      name: input.contact.name.trim(),
      phone: input.contact.phone.trim(),
    };
    const contactUpdates = {
      name: input.contact.name.trim(),
      phone: input.contact.phone.trim(),
      updatedAt: new Date(),
    };
    const [contact] = email
      ? await tx
          .insert(contacts)
          .values(contactValues)
          .onConflictDoUpdate({
            target: [contacts.schoolId, contacts.email],
            set: contactUpdates,
          })
          .returning()
      : await tx
          .insert(contacts)
          .values(contactValues)
          .onConflictDoUpdate({
            target: [contacts.schoolId, contacts.phone],
            set: contactUpdates,
          })
          .returning();
    if (!contact) throw new Error("contact_failed");

    let landingSessionId: string;
    if (input.source.channel === "web") {
      if (!input.source.landingSessionToken) {
        throw Object.assign(new Error("session_required"), {
          code: "session_required",
        });
      }
      const [session] = await tx
        .select()
        .from(landingSessions)
        .where(
          and(
            eq(landingSessions.schoolId, input.school.id),
            eq(landingSessions.sessionKeyHash, hashToken(input.source.landingSessionToken)),
          ),
        )
        .limit(1);
      if (!session) {
        throw Object.assign(new Error("session_required"), {
          code: "session_required",
        });
      }
      landingSessionId = session.id;
    } else {
      const sessionKeyHash = hashWaId(`whatsapp-landing:${input.source.waId}`);
      const now = new Date();
      const [existing] = await tx
        .select()
        .from(landingSessions)
        .where(
          and(
            eq(landingSessions.schoolId, input.school.id),
            eq(landingSessions.sessionKeyHash, sessionKeyHash),
          ),
        )
        .limit(1);
      if (existing) {
        await tx
          .update(landingSessions)
          .set({ lastSeenAt: now, utmSource: "whatsapp", updatedAt: now })
          .where(eq(landingSessions.id, existing.id));
        landingSessionId = existing.id;
      } else {
        const [created] = await tx
          .insert(landingSessions)
          .values({
            schoolId: input.school.id,
            sessionKeyHash,
            utmSource: "whatsapp",
            firstSeenAt: now,
            lastSeenAt: now,
            isPreview: false,
          })
          .returning();
        if (!created) throw new Error("landing_session_failed");
        landingSessionId = created.id;
      }
    }

    const [row] = await tx
      .insert(leads)
      .values({
        schoolId: input.school.id,
        landingSessionId,
        contactId: contact.id,
        participantName: input.participantName ?? null,
        participantAge: input.participantAge ?? null,
        trialOfferingId: input.offeringId ?? null,
        statedNeed: input.statedNeed ?? null,
        status: "open",
      })
      .returning();
    if (!row) throw new Error("lead_failed");

    await tx.insert(emailDeliveries).values({
      schoolId: input.school.id,
      leadId: row.id,
      kind: "owner_lead",
      recipient: await notificationEmail(input.school.id, tx),
      providerIdempotencyKey: `owner-lead/${row.id}`,
      nextAttemptAt: new Date(),
      state: "pending",
    });
    await tx.insert(funnelEvents).values({
      schoolId: input.school.id,
      landingSessionId,
      leadId: row.id,
      eventType: FUNNEL_EVENTS.leadCaptured,
      metadata:
        input.source.channel === "whatsapp"
          ? { channel: "whatsapp", hasOffering: Boolean(input.offeringId) }
          : { hasOffering: Boolean(input.offeringId) },
    });
    return row;
  };
  return withTransaction(write, options);
}
