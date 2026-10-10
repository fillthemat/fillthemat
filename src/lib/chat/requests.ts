import type { UIMessage } from "ai";
import { z } from "zod";
import { MAX_USER_MESSAGE_CHARS } from "@/lib/security/limits";
import { textFromMessage } from "./messages";
import { CHAT_ERRORS } from "./protocol";

export const chatTranscriptRequestSchema = z.object({
  slug: z.string().min(1),
  resumeToken: z.string().min(1),
  preview: z.boolean().default(false),
});

export const chatRequestSchema = chatTranscriptRequestSchema.extend({
  message: z
    .looseObject({
      id: z.string().min(1),
      role: z.literal("user"),
      metadata: z.unknown().optional(),
      // Preserve all UI parts; the assistant boundary performs SDK validation.
      parts: z.array(
        z.custom<UIMessage["parts"][number]>(
          (part) =>
            typeof part === "object" &&
            part !== null &&
            "type" in part &&
            typeof part.type === "string" &&
            (part.type !== "text" ||
              ("text" in part && typeof part.text === "string")),
        ),
      ),
    })
    .refine((message) => {
      const text = textFromMessage(message);
      return text.length > 0 && text.length <= MAX_USER_MESSAGE_CHARS;
    }, CHAT_ERRORS.invalidMessage),
});
