/** Public chat response codes shared by request validation and the browser. */
export const CHAT_ERRORS = {
  notFound: "not_found",
  invalidConversation: "invalid_conversation",
  generationInProgress: "generation_in_progress",
  duplicate: "duplicate",
  messageLimit: "limit",
  invalidMessage: "invalid_message",
  invalid: "invalid",
  tooLarge: "too_large",
} as const;

export type ChatError = (typeof CHAT_ERRORS)[keyof typeof CHAT_ERRORS];

export const CONVERSATION_LIMIT_NOTICE =
  "This conversation has reached its message limit. Your next message starts a fresh conversation.";
