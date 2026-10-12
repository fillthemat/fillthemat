import { z } from "zod";
import {
  MAX_REQUEST_BYTES,
  MAX_USER_MESSAGE_CHARS,
} from "@/lib/security/limits";
import { PoppyError } from "./errors";

export const poppyId = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/);
const object = z.record(z.string(), z.unknown());
const context = z
  .object({
    user_available: z.boolean().optional(),
    locale: z
      .string()
      .refine((value) => {
        try {
          return Intl.getCanonicalLocales(value).length === 1;
        } catch {
          return false;
        }
      })
      .optional(),
    time_zone: z
      .string()
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      })
      .optional(),
  })
  .catchall(z.unknown());
export const poppyMessage = z
  .object({
    id: poppyId,
    sender: z.enum(["agent", "human"]),
    text: z.string().max(MAX_USER_MESSAGE_CHARS).optional(),
    data: object.optional(),
    context: context.optional(),
  })
  .refine(
    (message) =>
      message.text !== undefined ||
      message.data !== undefined ||
      message.context !== undefined,
  );
export type PoppyMessage = z.infer<typeof poppyMessage>;

export async function readPoppyJson(request: Request): Promise<unknown> {
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim() !==
      "application/json" ||
    !request.body
  )
    throw new PoppyError("invalid_request");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new PoppyError("invalid_request", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new PoppyError("invalid_request");
  }
}

export function conversationReadOptions(request: Request) {
  const query = new URL(request.url).searchParams;
  const wait = query.get("wait");
  const cursor = query.get("cursor");
  if (
    wait !== null &&
    (!/^\d+(\.\d+)?$/.test(wait) || !Number.isFinite(Number(wait)))
  )
    throw new PoppyError("invalid_request");
  if (cursor !== null && !poppyId.safeParse(cursor).success)
    throw new PoppyError("invalid_cursor");
  return { wait: Math.min(Number(wait ?? 0), 20), cursor };
}
