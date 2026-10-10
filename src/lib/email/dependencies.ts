import type { CreateEmailOptions } from "resend";
import { isLocalEmailNoop } from "@/lib/dev-flags";
import { InternalFailure, type RetryFailure } from "@/lib/retry-policy";
import { getFromAddress, getResendOrNull } from "./resend";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  attachments?: CreateEmailOptions["attachments"];
  idempotencyKey: string;
};
export type EmailSendOutcome =
  | { ok: true; kind: "accepted"; providerId: string }
  | { ok: true; kind: "local_noop"; providerId: null }
  | ({ ok: false; message: string } & Extract<
      RetryFailure,
      { kind: "internal" | "email_error" }
    >);
export type EmailTransport = {
  send(message: EmailMessage): Promise<EmailSendOutcome>;
};
export type EmailSendDependencies = {
  transport: EmailTransport;
  now: () => Date;
};

const transport: EmailTransport = {
  async send({ idempotencyKey, ...message }) {
    const resend = getResendOrNull();
    if (!resend) {
      if (!isLocalEmailNoop())
        return {
          ok: false,
          kind: "internal",
          reason: "missing_credentials",
          message: "RESEND_API_KEY is not set",
        };
      console.info(`[local email noop] ${message.to}: ${message.subject}`);
      return { ok: true, kind: "local_noop", providerId: null };
    }
    if (!process.env.RESEND_FROM)
      throw new InternalFailure(
        "missing_credentials",
        "RESEND_FROM is not set",
      );
    try {
      const result = await resend.emails.send(
        { ...message, text: message.text ?? "", from: getFromAddress() },
        { idempotencyKey },
      );
      if (result.error)
        return {
          ok: false,
          kind: "email_error",
          name: result.error.name,
          status: result.error.statusCode ?? null,
          message: result.error.message,
        };
      if (!result.data?.id)
        return {
          ok: false,
          kind: "internal",
          reason: "malformed_response",
          message: "Email acceptance has no provider ID",
        };
      return { ok: true, kind: "accepted", providerId: result.data.id };
    } catch (error) {
      return {
        ok: false,
        kind: "internal",
        reason: "network_error",
        message: error instanceof Error ? error.message : "send_failed",
      };
    }
  },
};
export function emailSendDependencies(
  overrides: Partial<EmailSendDependencies> = {},
): EmailSendDependencies {
  return { transport, now: () => new Date(), ...overrides };
}
