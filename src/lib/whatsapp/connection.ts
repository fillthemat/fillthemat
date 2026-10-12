import { randomInt, randomUUID } from "node:crypto";
import {
  and,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { type Database, getDb } from "@/db";
import { schools, type WhatsAppConnectionState } from "@/db/schema";
import { encryptSchoolSecret, resolveSchoolSecret } from "./credentials";
import {
  type BrokenPart,
  brokenStates,
  isBroken,
  parseAccountUpdates,
} from "./health";
import {
  COOLING_OFF_DAYS,
  DAY_MS,
  RELEASE_BATCH_SIZE,
  RELEASE_LEASE_MS,
  SIGNUP_RESERVATION_DAYS,
  switchedOnStates,
} from "./lifecycle";

const releasableStates = [
  "cooling",
  "popup",
  "cancelled",
  "popup-failed",
] as const;
const eligibilityChecks = [
  {
    gap: "approval",
    field: "approvedAt",
    column: schools.approvedAt,
    trim: false,
  },
  {
    gap: "publishing",
    field: "publishedAt",
    column: schools.publishedAt,
    trim: false,
  },
  { gap: "phone", field: "phone", column: schools.phone, trim: true },
  {
    gap: "public-contact-email",
    field: "publicContactEmail",
    column: schools.publicContactEmail,
    trim: true,
  },
] as const;

function eligibilityConditions() {
  return and(
    ...eligibilityChecks.map(({ column, trim }) =>
      trim ? sql`length(trim(${column})) > 0` : isNotNull(column),
    ),
  );
}

const clearedConnection = {
  whatsappNumber: null,
  whatsappProviderResourceId: null,
  whatsappPhoneNumberId: null,
  whatsappWabaId: null,
  whatsappTokenEncrypted: null,
  whatsappTokenExpiresAt: null,
  whatsappRegistrationPinEncrypted: null,
  whatsappSignupAttemptId: null,
  whatsappSignupStartedAt: null,
  whatsappVerificationCode: null,
  whatsappVerificationExpiresAt: null,
  whatsappVerificationMessageIds: [],
  whatsappProfileName: null,
  whatsappCoolingStartedAt: null,
  whatsappReleaseAt: null,
  whatsappReleaseClaimedAt: null,
  whatsappDeregisteredAt: null,
};

import {
  type MetaSignupClient,
  MetaSignupError,
  metaSignupFromEnv,
} from "./meta-signup";
import { numberProviderFromEnv } from "./number-provider";

export const signupCompletionSchema = z.object({
  attemptId: z.uuid(),
  code: z.string().trim().min(1).max(4096),
  wabaId: z.string().regex(/^\d+$/).max(64),
  phoneNumberId: z.string().regex(/^\d+$/).max(64),
});
export type SignupCompletion = z.infer<typeof signupCompletionSchema>;

export type EligibilityGap =
  | "approval"
  | "publishing"
  | "phone"
  | "public-contact-email";

export type NumberProvider = {
  discardVerificationRecording?(input: {
    recordingId: string;
    transcriptionId: string | null;
  }): Promise<void>;
  verificationCall?(
    callId: string,
  ): Promise<{ receivedAt: Date; number: string } | null>;
  releaseNumber?(input: { resourceId: string }): Promise<void>;
  /** Carrier-authenticated creation time; webhook signatures have no timestamp. */
  verificationMessageReceivedAt?(messageId: string): Promise<Date | null>;
  /** A repeated allocation must resolve to the same rental, never another purchase. */
  buyUsNumber(input: {
    schoolId: string;
    allocationId: string;
    excludeNumber?: string;
  }): Promise<
    | { ok: true; number: string; resourceId: string }
    | { ok: false; code: "purchase_failed" | "unconfigured" }
  >;
};

export type WhatsAppConnectionView = {
  state: WhatsAppConnectionState;
  gaps: EligibilityGap[];
  number: string | null;
  profileName: string | null;
  providerResourceId: string | null;
  allocationId: string | null;
  attemptId: string | null;
  wabaId: string | null;
  phoneNumberId: string | null;
  verificationCode: string | null;
  releaseAt: Date | null;
};
export type EnableResult =
  | {
      ok: true;
      connection: WhatsAppConnectionView;
    }
  | {
      ok: false;
      code:
        | "ineligible"
        | "invalid_state"
        | "purchase_failed"
        | "unconfigured"
        | "signup_failed"
        | "invalid_assets"
        | "invalid_input";
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
  meta = metaSignupFromEnv(),
  now = () => new Date(),
}: {
  db?: Database;
  numberProvider?: NumberProvider;
  meta?: MetaSignupClient;
  now?: () => Date;
} = {}) {
  async function claimResult(
    schoolId: string,
    claim: unknown,
  ): Promise<EnableResult> {
    const connection = await read(schoolId);
    return claim
      ? { ok: true, connection }
      : { ok: false, code: "invalid_state", connection };
  }
  function reservationDeadline() {
    return new Date(now().getTime() + SIGNUP_RESERVATION_DAYS * DAY_MS);
  }
  async function read(schoolId: string): Promise<WhatsAppConnectionView> {
    const [school] = await db
      .select({
        approvedAt: schools.approvedAt,
        publishedAt: schools.publishedAt,
        phone: schools.phone,
        publicContactEmail: schools.publicContactEmail,
        state: schools.whatsappConnectionState,
        number: schools.whatsappNumber,
        profileName: schools.whatsappProfileName,
        providerResourceId: schools.whatsappProviderResourceId,
        allocationId: schools.whatsappAllocationId,
        attemptId: schools.whatsappSignupAttemptId,
        wabaId: schools.whatsappWabaId,
        phoneNumberId: schools.whatsappPhoneNumberId,
        verificationCode: schools.whatsappVerificationCode,
        verificationExpiresAt: schools.whatsappVerificationExpiresAt,
        releaseAt: schools.whatsappReleaseAt,
      })
      .from(schools)
      .where(eq(schools.id, schoolId));
    if (!school) throw new Error("WhatsApp school not found");
    const gaps = eligibilityChecks
      .filter(({ field }) => {
        const value = school[field];
        return typeof value === "string" ? !value.trim() : !value;
      })
      .map(({ gap }) => gap);
    return {
      state: school.state,
      gaps,
      number: school.number,
      profileName: school.profileName,
      providerResourceId: school.providerResourceId,
      allocationId: school.allocationId,
      attemptId: school.attemptId,
      wabaId: school.wabaId,
      phoneNumberId: school.phoneNumberId,
      releaseAt: school.releaseAt,
      verificationCode:
        school.state === "popup" &&
        school.verificationExpiresAt &&
        school.verificationExpiresAt > now()
          ? school.verificationCode
          : null,
    };
  }

  async function enable(schoolId: string): Promise<EnableResult> {
    const connection = await read(schoolId);
    if (connection.gaps.length)
      return { ok: false, code: "ineligible", connection };
    if (
      connection.state === "broken-number" &&
      connection.providerResourceId &&
      !numberProvider.releaseNumber
    )
      return { ok: false, code: "unconfigured", connection };
    const [claim] = await db
      .update(schools)
      .set({
        whatsappConnectionState: "buying",
        whatsappDeregistrationFailure: null,
        whatsappAllocationId: sql`coalesce(${schools.whatsappAllocationId}, ${randomUUID()}::uuid)`,
      })
      .where(
        and(
          eq(schools.id, schoolId),
          inArray(schools.whatsappConnectionState, [
            "off",
            "failed",
            "released",
            "broken-number",
          ]),
          eligibilityConditions(),
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
    if (connection.state === "broken-number") {
      // Meta no longer has this sending number. Release any remaining carrier
      // rental before buying another; an ambiguous release stays claimed.
      if (connection.providerResourceId)
        await numberProvider.releaseNumber?.({
          resourceId: connection.providerResourceId,
        });
      const freshAllocation = randomUUID();
      await db
        .update(schools)
        .set({
          ...clearedConnection,
          whatsappAllocationId: freshAllocation,
          whatsappDeregistrationFailure: null,
          whatsappHealthUpdatedAt: now(),
        })
        .where(
          and(
            eq(schools.id, schoolId),
            eq(schools.whatsappConnectionState, "buying"),
            eq(schools.whatsappAllocationId, claim.allocationId),
          ),
        );
      claim.allocationId = freshAllocation;
    }
    const purchased = await numberProvider.buyUsNumber({
      schoolId,
      allocationId: claim.allocationId,
      ...(connection.state === "broken-number" && connection.number
        ? { excludeNumber: connection.number }
        : {}),
    });
    if (
      purchased.ok &&
      connection.state === "broken-number" &&
      purchased.number === connection.number
    )
      throw new Error("Carrier reused a released WhatsApp number");
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
        whatsappReleaseAt: reservationDeadline(),
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
  async function checkReadiness(schoolId: string): Promise<EnableResult> {
    const connection = await read(schoolId);
    if (
      (connection.state !== "needs-card" && !isBroken(connection.state)) ||
      !connection.wabaId ||
      !connection.phoneNumberId
    )
      return { ok: false, code: "invalid_state", connection };
    const [school] = await db
      .select({
        id: schools.id,
        whatsappTokenEncrypted: schools.whatsappTokenEncrypted,
        whatsappTokenExpiresAt: schools.whatsappTokenExpiresAt,
        healthUpdatedAt: schools.whatsappHealthUpdatedAt,
      })
      .from(schools)
      .where(eq(schools.id, schoolId));
    if (!school?.whatsappTokenEncrypted)
      return { ok: false, code: "signup_failed", connection };
    try {
      const credential = resolveSchoolSecret(
        {
          id: school.id,
          encrypted: school.whatsappTokenEncrypted,
          expiresAt: school.whatsappTokenExpiresAt,
        },
        "token",
        now(),
      );
      if (!credential.ok) {
        await markBroken(schoolId, "access", {
          tokenEncrypted: school.whatsappTokenEncrypted,
          phoneNumberId: connection.phoneNumberId,
        });
        return {
          ok: false,
          code: "signup_failed",
          connection: await read(schoolId),
        };
      }
      const readiness = await meta.readReadiness({
        token: credential.secret,
        wabaId: connection.wabaId,
        phoneNumberId: connection.phoneNumberId,
        ...(isBroken(connection.state) ? { checkHealth: true } : {}),
      });
      await db
        .update(schools)
        .set({
          whatsappConnectionState:
            readiness.registered &&
            readiness.paymentMethod &&
            (!isBroken(connection.state) ||
              readiness.messagingAvailable === true)
              ? "live"
              : connection.state,
          whatsappProfileName: readiness.profileName,
          whatsappHealthUpdatedAt: new Date(
            Math.max(
              now().getTime(),
              (school.healthUpdatedAt?.getTime() ?? 0) + 1,
            ),
          ),
        })
        .where(
          and(
            eq(schools.id, schoolId),
            eq(schools.whatsappConnectionState, connection.state),
            eq(schools.whatsappWabaId, connection.wabaId),
            eq(schools.whatsappPhoneNumberId, connection.phoneNumberId),
            eq(schools.whatsappTokenEncrypted, school.whatsappTokenEncrypted),
            school.healthUpdatedAt
              ? eq(schools.whatsappHealthUpdatedAt, school.healthUpdatedAt)
              : isNull(schools.whatsappHealthUpdatedAt),
          ),
        );
      return { ok: true, connection: await read(schoolId) };
    } catch (error) {
      if (error instanceof MetaSignupError) {
        if (error.brokenPart)
          await markBroken(schoolId, error.brokenPart, {
            phoneNumberId: connection.phoneNumberId,
            tokenEncrypted: school.whatsappTokenEncrypted,
          });
        return {
          ok: false,
          code: error.code,
          connection: await read(schoolId),
        };
      }
      throw error;
    }
  }
  async function switchOff(schoolId: string): Promise<EnableResult> {
    const at = now();
    const [claim] = await db
      .update(schools)
      .set({
        whatsappConnectionState: "cooling",
        whatsappCoolingStartedAt: at,
        whatsappReleaseAt: new Date(at.getTime() + COOLING_OFF_DAYS * DAY_MS),
        whatsappVerificationCode: null,
        whatsappVerificationExpiresAt: null,
      })
      .where(
        and(
          eq(schools.id, schoolId),
          inArray(schools.whatsappConnectionState, switchedOnStates),
          isNull(schools.whatsappReleaseClaimedAt),
        ),
      )
      .returning({ id: schools.id });
    return claimResult(schoolId, claim);
  }

  async function switchOn(schoolId: string): Promise<EnableResult> {
    const connection = await read(schoolId);
    if (connection.gaps.length)
      return { ok: false, code: "ineligible", connection };
    if (
      connection.state !== "cooling" ||
      !connection.releaseAt ||
      connection.releaseAt <= now()
    )
      return { ok: false, code: "invalid_state", connection };
    const [school] = await db
      .select()
      .from(schools)
      .where(eq(schools.id, schoolId));
    if (!school) throw new Error("WhatsApp school not found");
    const restoreSetup = async (state: "popup" | "off" | "broken-access") => {
      const [claim] = await db
        .update(schools)
        .set({
          whatsappConnectionState: state,
          whatsappCoolingStartedAt: null,
          whatsappReleaseAt: state === "popup" ? reservationDeadline() : null,
        })
        .where(
          and(
            eq(schools.id, schoolId),
            eq(schools.whatsappConnectionState, "cooling"),
            gt(schools.whatsappReleaseAt, now()),
            isNull(schools.whatsappReleaseClaimedAt),
            eligibilityConditions(),
          ),
        )
        .returning({ id: schools.id });
      return claimResult(schoolId, claim);
    };
    if (!connection.wabaId || !connection.phoneNumberId) {
      const restored = await restoreSetup(connection.number ? "popup" : "off");
      return restored.ok && !connection.number ? enable(schoolId) : restored;
    }
    const credential = resolveSchoolSecret(
      {
        id: school.id,
        encrypted: school.whatsappTokenEncrypted,
        expiresAt: school.whatsappTokenExpiresAt,
      },
      "token",
      now(),
    );
    if (!credential.ok) return restoreSetup("broken-access");
    let readiness: Awaited<ReturnType<MetaSignupClient["readReadiness"]>>;
    try {
      readiness = await meta.readReadiness({
        token: credential.secret,
        wabaId: connection.wabaId,
        phoneNumberId: connection.phoneNumberId,
        checkHealth: true,
      });
    } catch (error) {
      if (error instanceof MetaSignupError)
        return {
          ok: false,
          code: error.code,
          connection: await read(schoolId),
        };
      throw error;
    }
    // The deadline, not the daily sweep's execution time, closes restoration.
    const [claim] = await db
      .update(schools)
      .set({
        whatsappConnectionState: !readiness.registered
          ? "broken-number"
          : !readiness.paymentMethod
            ? "needs-card"
            : readiness.messagingAvailable === true
              ? "live"
              : "broken-restricted",
        whatsappProfileName: readiness.profileName,
        whatsappCoolingStartedAt: null,
        whatsappReleaseAt: null,
      })
      .where(
        and(
          eq(schools.id, schoolId),
          eq(schools.whatsappConnectionState, "cooling"),
          gt(schools.whatsappReleaseAt, now()),
          isNull(schools.whatsappReleaseClaimedAt),
          eq(schools.whatsappPhoneNumberId, connection.phoneNumberId),
          eq(
            schools.whatsappTokenEncrypted,
            school.whatsappTokenEncrypted ?? "",
          ),
          eligibilityConditions(),
        ),
      )
      .returning({ id: schools.id });
    return claimResult(schoolId, claim);
  }

  async function markBroken(
    schoolId: string,
    part: BrokenPart,
    expected: {
      phoneNumberId?: string;
      tokenEncrypted?: string | null;
      wabaId?: string;
      at?: Date;
    } = {},
  ): Promise<EnableResult> {
    const [changed] = await db
      .update(schools)
      .set({
        whatsappConnectionState: `broken-${part}`,
        whatsappHealthUpdatedAt: expected.at ?? now(),
      })
      .where(
        and(
          eq(schools.id, schoolId),
          inArray(schools.whatsappConnectionState, [
            "live",
            "needs-card",
            ...brokenStates,
          ]),
          expected.phoneNumberId
            ? eq(schools.whatsappPhoneNumberId, expected.phoneNumberId)
            : undefined,
          expected.tokenEncrypted !== undefined
            ? expected.tokenEncrypted === null
              ? isNull(schools.whatsappTokenEncrypted)
              : eq(schools.whatsappTokenEncrypted, expected.tokenEncrypted)
            : undefined,
          expected.wabaId
            ? eq(schools.whatsappWabaId, expected.wabaId)
            : undefined,
          expected.at
            ? or(
                isNull(schools.whatsappHealthUpdatedAt),
                lt(schools.whatsappHealthUpdatedAt, expected.at),
              )
            : undefined,
        ),
      )
      .returning({ id: schools.id });
    return claimResult(schoolId, changed);
  }
  /** Trusted entry point: caller must authenticate Meta's raw-body signature. */
  async function handleAccountUpdates(
    payload: unknown,
    appId = process.env.WHATSAPP_APP_ID,
  ) {
    for (const update of parseAccountUpdates(payload, appId)) {
      const matching = await db
        .select({ id: schools.id })
        .from(schools)
        .where(eq(schools.whatsappWabaId, update.wabaId));
      for (const school of matching)
        await markBroken(school.id, update.part, {
          wabaId: update.wabaId,
          at: update.at,
        });
    }
  }
  async function startSignup(schoolId: string): Promise<EnableResult> {
    const [claim] = await db
      .update(schools)
      .set({
        whatsappConnectionState: "popup",
        whatsappSignupAttemptId: randomUUID(),
        // Twilio's date_created has second precision.
        whatsappSignupStartedAt: new Date(
          Math.floor(now().getTime() / 1000) * 1000,
        ),
        whatsappVerificationCode: null,
        whatsappVerificationExpiresAt: null,
        whatsappReleaseAt: reservationDeadline(),
      })
      .where(
        and(
          eq(schools.id, schoolId),
          inArray(schools.whatsappConnectionState, [
            "popup",
            "cancelled",
            "popup-failed",
            "broken-access",
          ]),
          isNotNull(schools.whatsappNumber),
          isNotNull(schools.whatsappAllocationId),
          isNull(schools.whatsappReleaseClaimedAt),
          or(
            isNull(schools.whatsappReleaseAt),
            gt(schools.whatsappReleaseAt, now()),
          ),
        ),
      )
      .returning({ id: schools.id });
    return claimResult(schoolId, claim);
  }

  async function release(schoolId: string): Promise<EnableResult> {
    const at = now();
    // A durable, bounded lease excludes restoration and concurrent releases.
    // Vendor calls are outside a transaction; a later sweep resumes progress.
    const [claim] = await db
      .update(schools)
      .set({ whatsappReleaseClaimedAt: at })
      .where(
        and(
          eq(schools.id, schoolId),
          inArray(schools.whatsappConnectionState, releasableStates),
          lte(schools.whatsappReleaseAt, at),
          or(
            isNull(schools.whatsappReleaseClaimedAt),
            lte(
              schools.whatsappReleaseClaimedAt,
              new Date(at.getTime() - RELEASE_LEASE_MS),
            ),
          ),
        ),
      )
      .returning();
    if (!claim)
      return {
        ok: false,
        code: "invalid_state",
        connection: await read(schoolId),
      };
    const owned = and(
      eq(schools.id, schoolId),
      eq(schools.whatsappConnectionState, claim.whatsappConnectionState),
      eq(schools.whatsappReleaseClaimedAt, at),
    );
    try {
      if (claim.whatsappProviderResourceId && !numberProvider.releaseNumber)
        throw new Error("WhatsApp carrier release unavailable");
      if (!claim.whatsappDeregisteredAt && claim.whatsappPhoneNumberId) {
        let failure: string | null = null;
        try {
          const credential = resolveSchoolSecret(
            {
              id: claim.id,
              encrypted: claim.whatsappTokenEncrypted,
              expiresAt: claim.whatsappTokenExpiresAt,
            },
            "token",
            at,
          );
          if (!credential.ok) failure = credential.code;
          else if (!meta.deregister) failure = "unconfigured";
          else
            await meta.deregister({
              token: credential.secret,
              phoneNumberId: claim.whatsappPhoneNumberId,
            });
        } catch (error) {
          // Carrier offboarding must not depend on continued Meta access. Store
          // only a safe code, never provider errors that can contain secrets.
          failure =
            error instanceof MetaSignupError
              ? error.code
              : "deregistration_failed";
        }
        if (failure)
          console.error(
            JSON.stringify({
              event: "whatsapp_deregistration_skipped",
              schoolId,
              code: failure,
            }),
          );
        await db
          .update(schools)
          .set({
            whatsappDeregisteredAt: failure ? null : now(),
            whatsappDeregistrationFailure: failure,
          })
          .where(owned);
      }
      if (claim.whatsappProviderResourceId)
        await numberProvider.releaseNumber?.({
          resourceId: claim.whatsappProviderResourceId,
        });
      await db
        .update(schools)
        .set({
          ...clearedConnection,
          whatsappConnectionState: "released",
          whatsappAllocationId: null,
        })
        .where(owned);
      return { ok: true, connection: await read(schoolId) };
    } catch (error) {
      // Keep the deadline and completed deregistration, but permit retry.
      await db
        .update(schools)
        .set({ whatsappReleaseClaimedAt: null })
        .where(owned);
      throw error;
    }
  }

  async function releaseDue(
    limit = RELEASE_BATCH_SIZE,
    options: { deadline?: Date } = {},
  ) {
    const due = await db
      .select({ id: schools.id })
      .from(schools)
      .where(
        and(
          inArray(schools.whatsappConnectionState, releasableStates),
          lte(schools.whatsappReleaseAt, now()),
        ),
      )
      .orderBy(schools.whatsappReleaseAt)
      .limit(limit);
    const counts = { released: 0, failed: 0, deferred: 0 };
    for (const school of due) {
      if (options.deadline && now() >= options.deadline) break;
      try {
        const result = await release(school.id);
        counts[result.ok ? "released" : "deferred"] += 1;
      } catch {
        counts.failed += 1;
        console.error(
          JSON.stringify({
            event: "whatsapp_release_failed",
            schoolId: school.id,
          }),
        );
      }
    }
    return counts;
  }

  async function endSignup(
    schoolId: string,
    attemptId: string,
    state: "cancelled" | "popup-failed",
  ): Promise<EnableResult> {
    const [claim] = await db
      .update(schools)
      .set({
        whatsappConnectionState: state,
        whatsappReleaseAt: reservationDeadline(),
        whatsappVerificationCode: null,
        whatsappVerificationExpiresAt: null,
      })
      .where(
        and(
          eq(schools.id, schoolId),
          eq(schools.whatsappSignupAttemptId, attemptId),
          eq(schools.whatsappConnectionState, "popup"),
          isNull(schools.whatsappReleaseClaimedAt),
          gt(schools.whatsappReleaseAt, now()),
        ),
      )
      .returning({ id: schools.id });
    return claimResult(schoolId, claim);
  }
  async function completeSignup(
    schoolId: string,
    input: SignupCompletion,
  ): Promise<EnableResult> {
    const parsed = signupCompletionSchema.safeParse(input);
    if (!parsed.success)
      return {
        ok: false,
        code: "invalid_input",
        connection: await read(schoolId),
      };
    const { attemptId, code, wabaId, phoneNumberId } = parsed.data;
    const [claim] = await db
      .update(schools)
      .set({
        whatsappConnectionState: "registering",
        whatsappVerificationCode: null,
        whatsappVerificationExpiresAt: null,
      })
      .where(
        and(
          eq(schools.id, schoolId),
          eq(schools.whatsappConnectionState, "popup"),
          eq(schools.whatsappSignupAttemptId, attemptId),
          isNotNull(schools.whatsappNumber),
          isNull(schools.whatsappReleaseClaimedAt),
          gt(schools.whatsappReleaseAt, now()),
        ),
      )
      .returning({
        number: schools.whatsappNumber,
        profileName: schools.name,
        email: schools.publicContactEmail,
        website: schools.website,
        phoneNumberId: schools.whatsappPhoneNumberId,
        pinEncrypted: schools.whatsappRegistrationPinEncrypted,
      });
    if (!claim?.number)
      return {
        ok: false,
        code: "invalid_state",
        connection: await read(schoolId),
      };
    const claimed = and(
      eq(schools.id, schoolId),
      eq(schools.whatsappSignupAttemptId, attemptId),
      eq(schools.whatsappConnectionState, "registering"),
    );
    try {
      // Exchange immediately: the popup code expires in about thirty seconds.
      const credential = await meta.exchangeCode(code);
      if (
        !credential.token.trim() ||
        (credential.expiresAt && credential.expiresAt <= now())
      )
        throw new MetaSignupError("signup_failed");
      if (
        !(await meta.validateNumber({
          token: credential.token,
          wabaId,
          phoneNumberId,
          number: claim.number,
        }))
      )
        throw new MetaSignupError("invalid_assets");
      const savedPin =
        claim.pinEncrypted && claim.phoneNumberId === phoneNumberId
          ? resolveSchoolSecret(
              {
                id: schoolId,
                encrypted: claim.pinEncrypted,
                expiresAt: null,
              },
              "pin",
            )
          : null;
      const pin = savedPin?.ok
        ? savedPin.secret
        : randomInt(0, 1_000_000).toString().padStart(6, "0");
      if (!pin) throw new Error("WhatsApp registration PIN unavailable");
      // Persist before external side effects; a retry of the same number keeps
      // its two-step PIN. It is NOT the verification code received by SMS.
      await db
        .update(schools)
        .set({
          whatsappWabaId: wabaId,
          whatsappPhoneNumberId: phoneNumberId,
          whatsappTokenEncrypted: encryptSchoolSecret(
            schoolId,
            credential.token,
            "token",
          ),
          whatsappTokenExpiresAt: credential.expiresAt,
          whatsappRegistrationPinEncrypted: encryptSchoolSecret(
            schoolId,
            pin,
            "pin",
          ),
        })
        .where(claimed);
      await meta.subscribe({ token: credential.token, wabaId });
      await meta.register({ token: credential.token, phoneNumberId, pin });
      await meta.updateProfile({
        token: credential.token,
        phoneNumberId,
        profileName: claim.profileName,
        email: claim.email,
        website: claim.website,
      });
      await db
        .update(schools)
        .set({
          whatsappConnectionState: "needs-card",
          whatsappProfileName: claim.profileName,
          whatsappReleaseAt: null,
        })
        .where(claimed);
      return { ok: true, connection: await read(schoolId) };
    } catch (error) {
      await db
        .update(schools)
        .set({
          whatsappConnectionState: "popup-failed",
          whatsappReleaseAt: reservationDeadline(),
        })
        .where(claimed);
      if (error instanceof MetaSignupError)
        return {
          ok: false,
          code: error.code,
          connection: await read(schoolId),
        };
      throw error;
    }
  }
  /** Called only after authenticating the carrier webhook, never from a browser. */
  async function acceptsVerificationFor(allocationId: string, number: string) {
    const [school] = await db
      .select({ id: schools.id })
      .from(schools)
      .where(
        and(
          eq(schools.whatsappAllocationId, allocationId),
          eq(schools.whatsappNumber, number),
          eq(schools.whatsappConnectionState, "popup"),
          isNotNull(schools.whatsappSignupAttemptId),
          gt(schools.whatsappReleaseAt, now()),
          isNull(schools.whatsappReleaseClaimedAt),
        ),
      );
    return !!school;
  }
  /** Called only after authenticating the carrier webhook, never from a browser. */
  async function receiveVerificationCode(input: {
    allocationId: string;
    number: string;
    messageId: string;
    code: string;
    receivedAt: Date;
  }): Promise<boolean> {
    if (
      !z
        .object({
          allocationId: z.uuid(),
          number: z.string().regex(/^\+1\d{10}$/),
          messageId: z.string().min(1).max(64),
          code: z.string().regex(/^\d{6}$/),
          receivedAt: z.date(),
        })
        .safeParse(input).success
    )
      return false;
    const expiresAt = new Date(input.receivedAt.getTime() + 10 * 60_000);
    if (input.receivedAt > now() || expiresAt <= now()) return false;
    const [saved] = await db
      .update(schools)
      .set({
        whatsappVerificationCode: input.code,
        whatsappVerificationExpiresAt: expiresAt,
        whatsappVerificationMessageIds: sql`array_append(${schools.whatsappVerificationMessageIds}, ${input.messageId})`,
      })
      .where(
        and(
          eq(schools.whatsappAllocationId, input.allocationId),
          eq(schools.whatsappNumber, input.number),
          eq(schools.whatsappConnectionState, "popup"),
          isNotNull(schools.whatsappSignupAttemptId),
          gt(schools.whatsappReleaseAt, now()),
          isNull(schools.whatsappReleaseClaimedAt),
          lte(schools.whatsappSignupStartedAt, input.receivedAt),
          sql`not (${input.messageId} = any(${schools.whatsappVerificationMessageIds}))`,
        ),
      )
      .returning({ id: schools.id });
    return !!saved;
  }
  return {
    read,
    enable,
    startSignup,
    completeSignup,
    checkReadiness,
    switchOff,
    switchOn,
    release,
    releaseDue,
    markBroken,
    handleAccountUpdates,
    acceptsVerificationFor,
    receiveVerificationCode,
    cancelSignup: (schoolId: string, attemptId: string) =>
      endSignup(schoolId, attemptId, "cancelled"),
    failSignup: (schoolId: string, attemptId: string) =>
      endSignup(schoolId, attemptId, "popup-failed"),
  };
}
