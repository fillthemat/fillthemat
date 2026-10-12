/** A platform notice, never an Assistant-generated response or booking. */
export function coolingReply(school: {
  phone: string | null;
  publicContactEmail: string | null;
}) {
  return `WhatsApp is switched off for this school. Please contact the school on ${school.phone} or ${school.publicContactEmail}.`;
}

/** Fence notices to one cooling period, not just a reusable phone number ID. */
export function coolingReplyPrefix(startedAt: Date) {
  return `wa-cooling/${startedAt.toISOString()}/`;
}
