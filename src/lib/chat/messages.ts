import type { UIMessage } from "ai";

export function textFromMessage(message: Pick<UIMessage, "parts">): string {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
}
