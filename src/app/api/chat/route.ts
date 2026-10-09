import { requestBodyTooLarge } from "@/lib/security/limits";
import {
  chatRequestSchema,
  chatTranscriptRequestSchema,
} from "@/lib/validation";
import {
  loadWebTranscript,
  startWebTurn,
  type WebTurnResult,
} from "@/lib/web-chat";

// Five minutes, safely below the ten-minute abandoned-generation threshold.
export const maxDuration = 300;

const refusals = {
  not_found: { status: 404, error: "not_found" },
  invalid_conversation: { status: 403, error: "invalid_conversation" },
  generation_in_progress: { status: 409, error: "generation_in_progress" },
  duplicate: { status: 409, error: "duplicate" },
  message_limit: { status: 429, error: "limit" },
  expired: { status: 410, error: "expired" },
} satisfies Record<
  Extract<WebTurnResult, { ok: false }>["reason"],
  { status: number; error: string }
>;

export async function POST(request: Request) {
  if (requestBodyTooLarge(request.headers.get("content-length"))) {
    return Response.json({ error: "too_large" }, { status: 413 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid" }, { status: 400 });
  }
  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    const invalidMessage = parsed.error.issues.some(
      (issue) => issue.message === "invalid_message",
    );
    return Response.json(
      { error: invalidMessage ? "invalid_message" : "invalid" },
      { status: 400 },
    );
  }
  const result = await startWebTurn(parsed.data);
  if (result.ok) return result.response;
  const { status, error } = refusals[result.reason];
  return Response.json({ error }, { status });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const parsed = chatTranscriptRequestSchema.safeParse({
    slug: params.get("slug"),
    resumeToken: params.get("resumeToken"),
    preview: params.get("preview") === "1",
  });
  if (!parsed.success) {
    return Response.json({ error: "invalid" }, { status: 400 });
  }
  const result = await loadWebTranscript(parsed.data);
  if (!result.ok)
    return Response.json({ error: result.reason }, { status: 404 });
  return Response.json({ messages: result.messages });
}
