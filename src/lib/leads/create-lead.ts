import { and, eq } from "drizzle-orm";
import {
  type Transaction,
  type TransactionOptions,
  withTransaction,
} from "@/db";
import {
  contacts,
  emailDeliveries,
  funnelEvents,
  landingSessions,
  leads,
  type School,
} from "@/db/schema";
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
  poppy: { clientId: string; userId: string };
};

/** Where a lead came from: its channel, and that channel's details. */
export type CreateLeadSource = {
  [C in keyof LeadSourceDetails]: { channel: C } & LeadSourceDetails[C];
}[keyof LeadSourceDetails];

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
 * Shared lead write path. Web, WhatsApp and confirmed Poppy Operations call
 * this so the transaction/email/funnel semantics stay
 * in one place.
 * A caller's transaction can include the lead and its outboxes in a Turn commit.
 *
 * - Contacts are upserted keyed `(school_id, email)` when an email is present
 *   (web semantics unchanged) and `(school_id, phone)` when there is none
 *   (WhatsApp no-email contacts, decision B).
 * - Web resolves the landing session from the client token; WhatsApp and Poppy
 *   synthesize stable channel-specific pseudo sessions so the NOT NULL landing
 *   session link and funnel analytics stay intact.
 * - Owner-lead delivery always stays email (`recipient` = school notification
 *   email); non-web funnel events record their Channel.
 */
export async function createLead(
  input: CreateLeadInput,
  options: TransactionOptions = {},
) {
  const email = input.contact.email
    ? normalizeEmail(input.contact.email)
    : null;

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
      // Poppy analytics identity is School/client/User, never Contact email or
      // Session: renewing or replacing credentials preserves attribution.
      const sessionKeyHash =
        input.source.channel === "whatsapp"
          ? hashWaId(`whatsapp-landing:${input.source.waId}`)
          : hashToken(
              JSON.stringify([
                "poppy-landing",
                input.school.id,
                input.source.clientId,
                input.source.userId,
              ]),
            );
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
            utmSource: input.source.channel,
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
            utmSource: input.source.channel,
            firstSeenAt: now,
            lastSeenAt: now,
            isPreview: false,
          })
          .onConflictDoUpdate({
            target: [landingSessions.schoolId, landingSessions.sessionKeyHash],
            set: {
              lastSeenAt: now,
              utmSource: input.source.channel,
              updatedAt: now,
            },
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
        channel: input.source.channel,
        poppyClientId:
          input.source.channel === "poppy" ? input.source.clientId : null,
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
      nextAttemptAt: new Date(),
      state: "pending",
    });
    await tx.insert(funnelEvents).values({
      schoolId: input.school.id,
      landingSessionId,
      leadId: row.id,
      eventType: FUNNEL_EVENTS.leadCaptured,
      metadata:
        input.source.channel !== "web"
          ? {
              channel: input.source.channel,
              hasOffering: Boolean(input.offeringId),
            }
          : { hasOffering: Boolean(input.offeringId) },
    });
    return row;
  };
  return withTransaction(write, options);
}
