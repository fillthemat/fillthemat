import type { WhatsAppConnectionView } from "@/lib/whatsapp/connection";

export type WhatsAppSettingsView = Pick<
  WhatsAppConnectionView,
  | "state"
  | "gaps"
  | "number"
  | "profileName"
  | "attemptId"
  | "verificationCode"
  | "releaseAt"
> & { managerUrl: string };

/** The browser needs a destination link, not raw account/carrier identifiers. */
export function whatsAppSettingsView(
  connection: WhatsAppConnectionView,
): WhatsAppSettingsView {
  return {
    state: connection.state,
    gaps: connection.gaps,
    number: connection.number,
    profileName: connection.profileName,
    attemptId: connection.attemptId,
    verificationCode: connection.verificationCode,
    releaseAt: connection.releaseAt,
    managerUrl: `https://business.facebook.com/wa/manage/home/${connection.wabaId ? `?waba_id=${encodeURIComponent(connection.wabaId)}` : ""}`,
  };
}
