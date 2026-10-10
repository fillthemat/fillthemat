import { CHAT_ERRORS, type ChatError } from "@/lib/chat/protocol";
import { requestBodyTooLarge } from "@/lib/security/limits";
import {
  chatRequestSchema,
  chatTranscriptRequestSchema,
} from "@/lib/validation";
import {
  loadWebTranscript,
  startWebTurn,
  type WebTurnResult,
} from "@/lib/web-chat/web-chat";

// Five minutes, safely below the ten-minute abandoned-generation threshold.
export const maxDuration = 300;

const refusals = {
  not_found: { status: 404, error: CHAT_ERRORS.notFound },
  invalid_conversation: { status: 403, error: CHAT_ERRORS.invalidConversation },
  generation_in_progress: {
    status: 409,
    error: CHAT_ERRORS.generationInProgress,
  },
  duplicate: { status: 409, error: CHAT_ERRORS.duplicate },
  message_limit: { status: 429, error: CHAT_ERRORS.messageLimit },
} satisfies Record<
  Extract<WebTurnResult, { ok: false }>["reason"],
  { status: number; error: ChatError }
>;

export async function POST(request: Request) {
  if (requestBodyTooLarge(request.headers.get("content-length"))) {
    return Response.json({ error: CHAT_ERRORS.tooLarge }, { status: 413 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: CHAT_ERRORS.invalid }, { status: 400 });
  }
  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    const invalidMessage = parsed.error.issues.some(
      (issue) => issue.message === CHAT_ERRORS.invalidMessage,
    );
    return Response.json(
      {
        error: invalidMessage
          ? CHAT_ERRORS.invalidMessage
          : CHAT_ERRORS.invalid,
      },
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
    return Response.json({ error: CHAT_ERRORS.invalid }, { status: 400 });
  }
  const result = await loadWebTranscript(parsed.data);
  if (!result.ok)
    return Response.json({ error: result.reason }, { status: 404 });
  return Response.json({ messages: result.messages });
}
