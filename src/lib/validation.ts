import type { UIMessage } from "ai";
import { z } from "zod";
import { textFromMessage } from "./chat/messages";
import { CHAT_ERRORS } from "./chat/protocol";
import { MAX_USER_MESSAGE_CHARS } from "./security/limits";
import { isValidSlug, normalizeSlug } from "./slug";

export const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .email()
  .transform((value) => value.toLowerCase());

export const phoneSchema = z.string().trim().min(7).max(32);

export const personNameSchema = z.string().trim().min(1).max(80);

export const ageSchema = z.number().int().min(0).max(99);

export const hexColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/)
  .optional()
  .or(z.literal("").transform(() => undefined));

export const httpsUrlSchema = z
  .string()
  .url()
  .refine((value) => value.startsWith("https://"), "Must be an HTTPS URL")
  .max(2048);

export const slugSchema = z
  .string()
  .transform(normalizeSlug)
  .refine(isValidSlug, "Use 3-48 lowercase letters, numbers, and hyphens");

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length === 0 ? null : value));

export const timezoneSchema = z.string().min(1).max(64);

export const onboardingSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: slugSchema,
  timezone: timezoneSchema,
  city: optionalText(80),
  notificationEmail: emailSchema,
});

export const contactSchema = z.object({
  name: personNameSchema,
  email: emailSchema,
  phone: phoneSchema,
});

export const participantSchema = z.object({
  name: personNameSchema,
  age: ageSchema,
});

export const bookingRequestSchema = z.object({
  schoolSlug: slugSchema,
  offeringId: z.string().uuid(),
  slotId: z.string().min(1).max(200),
  idempotencyKey: z.string().uuid(),
  contact: contactSchema,
  participant: participantSchema,
  turnstileToken: z.string().min(1).max(4096),
  landingSessionToken: z.string().min(1).max(256).optional(),
  conversationResumeToken: z.string().min(1).max(256).optional(),
});

export const leadRequestSchema = z.object({
  schoolSlug: slugSchema,
  contact: contactSchema,
  participantName: optionalText(80),
  participantAge: ageSchema.optional(),
  offeringId: z.string().uuid().optional(),
  statedNeed: optionalText(1000),
  turnstileToken: z.string().min(1).max(4096),
  landingSessionToken: z.string().min(1).max(256).optional(),
});

export const chatTranscriptRequestSchema = z.object({
  slug: z.string().min(1),
  resumeToken: z.string().min(1),
  preview: z.boolean().default(false),
});

export const landingSessionRequestSchema = z.object({
  slug: z.string().min(1),
  token: z.string().min(16),
  preview: z.boolean().optional(),
  utm: z.record(z.string(), z.string().optional()).optional(),
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
