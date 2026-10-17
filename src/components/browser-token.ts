export function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function conversationStorageKey(slug: string): string {
  return `fillthemat.conversation.${slug}`;
}

export function readConversationToken(slug: string): string {
  const existing = window.localStorage.getItem(conversationStorageKey(slug));
  if (existing) return existing;
  const token = randomToken();
  window.localStorage.setItem(conversationStorageKey(slug), token);
  return token;
}
