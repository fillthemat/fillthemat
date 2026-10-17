/**
 * WhatsApp free-form text messages are capped at 4096 characters. Split a long
 * agent reply into the fewest chunks without breaking surrogate pairs, so each
 * chunk is a safe standalone Graph `text` message.
 */
export const WHATSAPP_TEXT_CHAR_LIMIT = 4096;

export function splitWhatsAppText(text: string, limit = WHATSAPP_TEXT_CHAR_LIMIT): string[] {
  const body = text.trim();
  if (!body) return [];
  const out: string[] = [];
  let start = 0;
  while (start < body.length) {
    let end = Math.min(start + limit, body.length);
    // Never split a UTF-16 surrogate pair: back off to the previous code unit.
    if (end < body.length) {
      const code = body.charCodeAt(end - 1);
      if (code >= 0xd800 && code <= 0xdbff) end -= 1;
    }
    out.push(body.slice(start, end));
    start = end;
  }
  return out;
}
