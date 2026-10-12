import { randomInt, randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { type Database, getDb } from "@/db";
import { schools, type WhatsAppConnectionState } from "@/db/schema";
import { encryptWhatsAppToken, resolveWhatsAppToken } from "./credentials";
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
  /** Carrier-authenticated creation time; webhook signatures have no timestamp. */
  verificationMessageReceivedAt?(messageId: string): Promise<Date | null>;
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
  attemptId: string | null;
  wabaId: string | null;
  phoneNumberId: string | null;
  verificationCode: string | null;
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
        attemptId: schools.whatsappSignupAttemptId,
        wabaId: schools.whatsappWabaId,
        phoneNumberId: schools.whatsappPhoneNumberId,
        verificationCode: schools.whatsappVerificationCode,
        verificationExpiresAt: schools.whatsappVerificationExpiresAt,
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
      attemptId: school.attemptId,
      wabaId: school.wabaId,
      phoneNumberId: school.phoneNumberId,
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
      })
      .where(
        and(
          eq(schools.id, schoolId),
          inArray(schools.whatsappConnectionState, [
            "popup",
            "cancelled",
            "popup-failed",
          ]),
          isNotNull(schools.whatsappNumber),
          isNotNull(schools.whatsappAllocationId),
        ),
      )
      .returning({ id: schools.id });
    return claim
      ? { ok: true, connection: await read(schoolId) }
      : { ok: false, code: "invalid_state", connection: await read(schoolId) };
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
        whatsappVerificationCode: null,
        whatsappVerificationExpiresAt: null,
      })
      .where(
        and(
          eq(schools.id, schoolId),
          eq(schools.whatsappSignupAttemptId, attemptId),
          eq(schools.whatsappConnectionState, "popup"),
        ),
      )
      .returning({ id: schools.id });
    return claim
      ? { ok: true, connection: await read(schoolId) }
      : { ok: false, code: "invalid_state", connection: await read(schoolId) };
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
        ),
      )
      .returning({
        number: schools.whatsappNumber,
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
      const pin =
        claim.pinEncrypted && claim.phoneNumberId === phoneNumberId
          ? resolveWhatsAppToken({
              id: schoolId,
              whatsappTokenEncrypted: claim.pinEncrypted,
              whatsappTokenExpiresAt: null,
            })
          : randomInt(0, 1_000_000).toString().padStart(6, "0");
      if (!pin) throw new Error("WhatsApp registration PIN unavailable");
      // Persist before external side effects; a retry of the same number keeps
      // its two-step PIN. It is NOT the verification code received by SMS.
      await db
        .update(schools)
        .set({
          whatsappWabaId: wabaId,
          whatsappPhoneNumberId: phoneNumberId,
          whatsappTokenEncrypted: encryptWhatsAppToken(
            schoolId,
            credential.token,
          ),
          whatsappTokenExpiresAt: credential.expiresAt,
          whatsappRegistrationPinEncrypted: encryptWhatsAppToken(schoolId, pin),
        })
        .where(claimed);
      await meta.subscribe({ token: credential.token, wabaId });
      await meta.register({ token: credential.token, phoneNumberId, pin });
      await db
        .update(schools)
        .set({ whatsappConnectionState: "needs-card" })
        .where(claimed);
      return { ok: true, connection: await read(schoolId) };
    } catch (error) {
      await db
        .update(schools)
        .set({ whatsappConnectionState: "popup-failed" })
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
    receiveVerificationCode,
    cancelSignup: (schoolId: string, attemptId: string) =>
      endSignup(schoolId, attemptId, "cancelled"),
    failSignup: (schoolId: string, attemptId: string) =>
      endSignup(schoolId, attemptId, "popup-failed"),
  };
}
