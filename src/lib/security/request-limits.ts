// Pure request/assistant limits. Safe to import without a database connection.
export const MAX_CHAT_MESSAGES_PER_CONVERSATION = 30;
export const MAX_USER_MESSAGE_CHARS = 2000;
export const MAX_REQUEST_BYTES = 32_768;
export const MAX_AGENT_STEPS = 8;

export function requestBodyTooLarge(contentLength: string | null): boolean {
  if (!contentLength) return false;
  const size = Number(contentLength);
  return Number.isFinite(size) && size > MAX_REQUEST_BYTES;
}
