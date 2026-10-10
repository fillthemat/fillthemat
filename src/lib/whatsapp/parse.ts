export type InboundWhatsAppMessage = {
  phoneNumberId: string;
  wamid: string;
  waId: string;
  text: string | null;
  /** The prospect's WhatsApp profile name, when Meta includes it. */
  profileName: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read only the recipient needed by job-death fallback from a persisted payload. */
export function jobRecipientWaId(payload: unknown): string | null {
  return isRecord(payload) &&
    typeof payload.waId === "string" &&
    payload.waId.trim()
    ? payload.waId
    : null;
}

function textFromMessage(message: Record<string, unknown>): string | null {
  const text = message.text;
  if (isRecord(text) && typeof text.body === "string" && text.body.trim()) {
    return text.body;
  }
  // Interactive button replies (e.g. `confirm_booking:<id>`) are recognized in
  // Phase 5; keep them flowing through as text so the parser stays total.
  const interactive = message.interactive;
  if (isRecord(interactive)) {
    const buttonReply = interactive.button_reply;
    if (isRecord(buttonReply) && typeof buttonReply.id === "string") {
      return buttonReply.id;
    }
  }
  return null;
}

/**
 * Normalize a Meta webhook payload into inbound messages.
 *
 * Iterates `entry[] -> changes[] -> value.messages[]` defensively as arrays so a
 * malformed/status payload simply yields an empty list (which the route acks).
 */
export function parseInboundWhatsAppMessages(
  payload: unknown,
): InboundWhatsAppMessage[] {
  if (!isRecord(payload) || !Array.isArray(payload.entry)) return [];

  const out: InboundWhatsAppMessage[] = [];
  for (const entry of payload.entry) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      if (!isRecord(change) || !isRecord(change.value)) continue;
      const value = change.value;
      const metadata = isRecord(value.metadata) ? value.metadata : {};
      const phoneNumberId =
        typeof metadata.phone_number_id === "string"
          ? metadata.phone_number_id
          : "";

      let contactWaId: string | null = null;
      let profileName: string | null = null;
      const contacts = value.contacts;
      if (Array.isArray(contacts)) {
        for (const contact of contacts) {
          if (
            isRecord(contact) &&
            typeof contact.wa_id === "string" &&
            contactWaId === null
          ) {
            contactWaId = contact.wa_id;
          }
          if (
            isRecord(contact) &&
            profileName === null &&
            isRecord(contact.profile) &&
            typeof contact.profile.name === "string"
          ) {
            profileName = contact.profile.name;
          }
          if (contactWaId !== null && profileName !== null) break;
        }
      }
      if (profileName == null || profileName.trim() === "") {
        profileName = null;
      } else {
        profileName = profileName.trim();
      }

      if (!Array.isArray(value.messages)) continue;
      for (const message of value.messages) {
        if (!isRecord(message)) continue;
        const wamid = typeof message.id === "string" ? message.id : "";
        const waId =
          (typeof message.from === "string" ? message.from : "") ||
          contactWaId ||
          "";
        if (!phoneNumberId || !wamid || !waId) continue;
        out.push({
          phoneNumberId,
          wamid,
          waId,
          text: textFromMessage(message),
          profileName,
        });
      }
    }
  }
  return out;
}
