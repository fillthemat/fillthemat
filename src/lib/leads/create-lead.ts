import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  contacts,
  emailDeliveries,
  funnelEvents,
  landingSessions,
  leads,
  type School,
} from "@/db/schema";
import type { Channel } from "@/lib/channel";
import { hashToken, hashWaId, normalizeEmail } from "@/lib/crypto";
import { FUNNEL_EVENTS } from "@/lib/funnel";

export type CreateLeadContact = {
  name: string;
  email: string | null;
  phone: string;
};

type LeadSourceDetails = {
  web: { landingSessionToken: string | undefined };
  whatsapp: { waId: string };
};

/** Where a lead came from: its channel, and that channel's details. */
export type CreateLeadSource = {
  [C in Channel]: { channel: C } & LeadSourceDetails[C];
}[Channel];

export type CreateLeadInput = {
  school: School;
  contact: CreateLeadContact;
  source: CreateLeadSource;
  participantName?: string | null;
  participantAge?: number | null;
  offeringId?: string | null;
  statedNeed?: string | null;
};

/**
 * Shared lead write path (decision J / Phase 5). Web (`POST /api/leads`) and the
 * WhatsApp worker both call this so the transaction/email/funnel semantics stay
 * in one place.
 *
 * - Contacts are upserted keyed `(school_id, email)` when an email is present
 *   (web semantics unchanged) and `(school_id, phone)` when there is none
 *   (WhatsApp no-email contacts, decision B).
 * - Web resolves the landing session from the client token; WhatsApp synthesizes
 *   a stable pseudo-session keyed by wa id with `utm_source='whatsapp'` so the
 *   `leads.landingSessionId NOT NULL` + funnel analytics intact.
 * - Owner-lead delivery always stays email (`recipient` = school notification
 *   email); the funnel event records `{ channel: 'whatsapp' }` for WhatsApp.
 */
export async function createLead(input: CreateLeadInput) {
  const db = getDb();
  const email = input.contact.email
    ? normalizeEmail(input.contact.email)
    : null;

  return db.transaction(async (tx) => {
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
            eq(
              landingSessions.sessionKeyHash,
              hashToken(input.source.landingSessionToken),
            ),
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
      // Synthesize a stable pseudo session keyed by wa id (decision J).
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
          .set({
            lastSeenAt: now,
            utmSource: "whatsapp",
            updatedAt: now,
          })
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
      recipient: input.school.notificationEmail,
      providerIdempotencyKey: `owner-lead/${row.id}`,
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
  });
}
