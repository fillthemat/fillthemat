import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { type Database, getDb } from "@/db";
import { schools, type WhatsAppConnectionState } from "@/db/schema";
import { numberProviderFromEnv } from "./number-provider";

export type EligibilityGap =
  | "approval"
  | "publishing"
  | "phone"
  | "public-contact-email";

export type NumberProvider = {
  /** A repeated allocation must resolve to the same rental, never another purchase. */
  buyUsNumber(input: {
    schoolId: string;
    allocationId: string;
  }): Promise<
    | { ok: true; number: string; resourceId: string }
    | { ok: false; code: "purchase_failed" | "unconfigured" }
  >;
};

export type WhatsAppConnectionView = {
  state: WhatsAppConnectionState;
  gaps: EligibilityGap[];
  number: string | null;
  providerResourceId: string | null;
  allocationId: string | null;
};
export type EnableResult =
  | {
      ok: true;
      connection: WhatsAppConnectionView;
    }
  | {
      ok: false;
      code: "ineligible" | "invalid_state" | "purchase_failed" | "unconfigured";
      connection: WhatsAppConnectionView;
    };

/**
 * Sole owner of connection-state writes. Settings, webhooks and jobs call this
 * module; later lifecycle commands belong here alongside enable/read.
 * Trusted callers supply a school ID; owner entry points derive it from auth.
 * Vendor calls run outside transactions. Expected refusals return codes;
 * unexpected/ambiguous errors throw and leave buying claimed for support
 * reconciliation, rather than risk purchasing twice after a lost response.
 */
export function createWhatsAppConnection({
  db = getDb(),
  numberProvider = numberProviderFromEnv(),
}: {
  db?: Database;
  numberProvider?: NumberProvider;
} = {}) {
  async function read(schoolId: string): Promise<WhatsAppConnectionView> {
    const [school] = await db
      .select({
        approvedAt: schools.approvedAt,
        publishedAt: schools.publishedAt,
        phone: schools.phone,
        publicContactEmail: schools.publicContactEmail,
        state: schools.whatsappConnectionState,
        number: schools.whatsappNumber,
        providerResourceId: schools.whatsappProviderResourceId,
        allocationId: schools.whatsappAllocationId,
      })
      .from(schools)
      .where(eq(schools.id, schoolId));
    if (!school) throw new Error("WhatsApp school not found");
    const gaps: EligibilityGap[] = [];
    if (!school.approvedAt) gaps.push("approval");
    if (!school.publishedAt) gaps.push("publishing");
    if (!school.phone?.trim()) gaps.push("phone");
    if (!school.publicContactEmail?.trim()) gaps.push("public-contact-email");
    return {
      state: school.state,
      gaps,
      number: school.number,
      providerResourceId: school.providerResourceId,
      allocationId: school.allocationId,
    };
  }

  async function enable(schoolId: string): Promise<EnableResult> {
    const connection = await read(schoolId);
    if (connection.gaps.length)
      return { ok: false, code: "ineligible", connection };
    const [claim] = await db
      .update(schools)
      .set({
        whatsappConnectionState: "buying",
        whatsappAllocationId: sql`coalesce(${schools.whatsappAllocationId}, ${randomUUID()}::uuid)`,
      })
      .where(
        and(
          eq(schools.id, schoolId),
          inArray(schools.whatsappConnectionState, ["off", "failed"]),
          isNotNull(schools.approvedAt),
          isNotNull(schools.publishedAt),
          sql`length(trim(${schools.phone})) > 0`,
          sql`length(trim(${schools.publicContactEmail})) > 0`,
        ),
      )
      .returning({ allocationId: schools.whatsappAllocationId });
    if (!claim?.allocationId) {
      const current = await read(schoolId);
      return {
        ok: false,
        code: current.gaps.length ? "ineligible" : "invalid_state",
        connection: current,
      };
    }
    const purchased = await numberProvider.buyUsNumber({
      schoolId,
      allocationId: claim.allocationId,
    });
    if (!purchased.ok) {
      await db
        .update(schools)
        .set({ whatsappConnectionState: "failed" })
        .where(
          and(
            eq(schools.id, schoolId),
            eq(schools.whatsappConnectionState, "buying"),
            eq(schools.whatsappAllocationId, claim.allocationId),
          ),
        );
      return {
        ok: false,
        code: purchased.code,
        connection: await read(schoolId),
      };
    }
    await db
      .update(schools)
      .set({
        whatsappConnectionState: "popup",
        whatsappNumber: purchased.number,
        whatsappProviderResourceId: purchased.resourceId,
      })
      .where(
        and(
          eq(schools.id, schoolId),
          eq(schools.whatsappConnectionState, "buying"),
          eq(schools.whatsappAllocationId, claim.allocationId),
        ),
      );
    return { ok: true, connection: await read(schoolId) };
  }
  return { read, enable };
}
