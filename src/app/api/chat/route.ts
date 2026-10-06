import { createHash, randomUUID } from "node:crypto";
import {
  type LangfuseSpan,
  propagateAttributes,
  startActiveObservation,
} from "@langfuse/tracing";
import {
  createAgentUIStreamResponse,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  type UIMessage,
  validateUIMessages,
} from "ai";
import { addDays } from "date-fns";
import { and, asc, eq, isNull } from "drizzle-orm";
import { after } from "next/server";
import { getDb } from "@/db";
import { conversations, messages } from "@/db/schema";
import {
  type BookingTraceState,
  createBookingAgent,
} from "@/lib/ai/booking-agent";
import { buildBookingAgentInstructions } from "@/lib/ai/system-prompt";
import { hashToken } from "@/lib/crypto";
import { isLocalAiStub } from "@/lib/dev-flags";
import {
  debugOwner,
  isDebugSameOrigin,
  verifyDebugContext,
} from "@/lib/observability/debug-context";
import { captureRuntime, flushCapture } from "@/lib/observability/tracing";
import { TRANSCRIPT_RETENTION_DAYS } from "@/lib/schedule/constants";
import {
  getSchoolForLandingAccess,
  loadSchoolCatalog,
} from "@/lib/schools/public";
import {
  MAX_CHAT_MESSAGES_PER_CONVERSATION,
  MAX_USER_MESSAGE_CHARS,
  requestBodyTooLarge,
} from "@/lib/security/limits";

function textFromMessage(message: UIMessage): string {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
}

export async function POST(request: Request) {
  const requestStarted = Date.now();
  if (requestBodyTooLarge(request.headers.get("content-length"))) {
    return Response.json({ error: "too_large" }, { status: 413 });
  }

  const body = (await request.json()) as {
    slug?: string;
    resumeToken?: string;
    preview?: boolean;
    debugContext?: string;
    message?: UIMessage;
  };
  if (
    !body.slug ||
    !body.resumeToken ||
    !body.message ||
    body.message.role !== "user"
  ) {
    return Response.json({ error: "invalid" }, { status: 400 });
  }
  const userText = textFromMessage(body.message);
  if (!userText || userText.length > MAX_USER_MESSAGE_CHARS) {
    return Response.json({ error: "invalid_message" }, { status: 400 });
  }

  const school = await getSchoolForLandingAccess(body.slug, {
    preview: Boolean(body.preview),
  });
  if (!school) return Response.json({ error: "not_found" }, { status: 404 });

  // Debug resume tokens are disjoint from prospect tokens. Never accept one without
  // a fresh owner check and a signed context bound to this exact school/token.
  const debugRequested =
    Boolean(body.debugContext) || body.resumeToken.startsWith("dbg_");
  const ownerId = debugRequested ? await debugOwner(school) : null;
  if (
    debugRequested &&
    (!body.debugContext ||
      !ownerId ||
      !body.resumeToken.startsWith("dbg_") ||
      !verifyDebugContext(
        body.debugContext,
        school.id,
        ownerId,
        body.resumeToken,
      ) ||
      !isDebugSameOrigin(request))
  ) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  let runtime: ReturnType<typeof captureRuntime> = null;
  if (ownerId && !isLocalAiStub()) {
    try {
      runtime = captureRuntime();
    } catch {
      console.error(JSON.stringify({ event: "chat_debug_init_failed" }));
    }
  }
  if (debugRequested && !runtime)
    return Response.json({ error: "debug_unavailable" }, { status: 503 });
  const requestId = randomUUID();

  const db = getDb();
  const tokenHash = hashToken(body.resumeToken);
  const now = new Date();
  const purgeAt = addDays(now, TRANSCRIPT_RETENTION_DAYS);

  let [conversation] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.schoolId, school.id),
        eq(conversations.resumeTokenHash, tokenHash),
      ),
    )
    .limit(1);

  if (!conversation) {
    const [created] = await db
      .insert(conversations)
      .values({
        schoolId: school.id,
        resumeTokenHash: tokenHash,
        expiresAt: purgeAt,
      })
      .onConflictDoNothing({ target: conversations.resumeTokenHash })
      .returning();
    conversation = created;
    if (!conversation) {
      const [again] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.resumeTokenHash, tokenHash))
        .limit(1);
      if (!again || again.schoolId !== school.id) {
        return Response.json(
          { error: "invalid_conversation" },
          { status: 403 },
        );
      }
      conversation = again;
    }
  }

  const reject = (outcome: string, status: number) => {
    if (runtime) {
      console.info(
        JSON.stringify({
          event: "turn_rejected",
          requestId,
          conversationId: conversation.id,
          outcome,
        }),
      );
      propagateAttributes(
        {
          sessionId: conversation.id,
          traceName: "booking-chat.turn",
          metadata: {
            debugCapture: "true",
            schoolId: school.id,
            requestId,
            channel: "web",
            captureSchemaVersion: "1",
          },
        },
        () =>
          startActiveObservation("booking-chat.turn", (root) => {
            console.info(
              JSON.stringify({
                event: "turn_rejected_trace",
                requestId,
                traceId: root.traceId,
                conversationId: conversation.id,
                outcome,
              }),
            );
            root.update({
              input: userText,
              output: `[${outcome}]`,
              metadata: {
                outcome,
                requestId,
                userMessageId: body.message?.id,
                captureSchemaVersion: 1,
              },
            });
          }),
      );
      after(flushCapture);
    }
    return Response.json(
      { error: outcome, requestId },
      {
        status,
        headers: runtime ? { "x-chat-request-id": requestId } : undefined,
      },
    );
  };

  if (conversation.expiresAt <= now) {
    return reject("expired", 410);
  }

  const claimed = await db
    .update(conversations)
    .set({ generatingAt: now, updatedAt: now })
    .where(
      and(
        eq(conversations.id, conversation.id),
        isNull(conversations.generatingAt),
      ),
    )
    .returning();
  if (!claimed[0]) return reject("generation_in_progress", 409);

  const releaseLock = async () => {
    await db
      .update(conversations)
      .set({ generatingAt: null, updatedAt: new Date() })
      .where(eq(conversations.id, conversation.id));
  };
  try {
    const contextStarted = Date.now();
    const stored = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversation.id))
      .orderBy(asc(messages.createdAt));

    if (stored.length >= MAX_CHAT_MESSAGES_PER_CONVERSATION) {
      await releaseLock();
      return reject("limit", 429);
    }

    if (stored.some((row) => row.messageId === body.message?.id)) {
      await releaseLock();
      return reject("duplicate", 409);
    }

    const catalog = await loadSchoolCatalog(school.id);
    const contextLoadMs = Date.now() - contextStarted;

    const history = stored.map((row) => ({
      id: row.messageId,
      role: row.role as UIMessage["role"],
      parts: row.parts as UIMessage["parts"],
    }));
    const uiMessages = await validateUIMessages({
      messages: [...history, body.message],
    });

    const prompt = runtime
      ? buildBookingAgentInstructions({
          name: school.name,
          timezone: school.timezone,
          city: school.city,
          address: school.address,
          phone: school.phone,
          website: school.website,
          parkingNotes: school.parkingNotes,
          accessNotes: school.accessNotes,
          trialGuidance: school.trialGuidance,
          pricing: school.pricing,
          welcomeMessage: school.welcomeMessage,
          agentInstructions: school.agentInstructions,
          faqs: catalog.faqs,
        })
      : "";
    const digest = (value: string) =>
      createHash("sha256").update(value).digest("hex");
    let trace: BookingTraceState | undefined = runtime
      ? {
          integration: runtime.integration,
          stepCount: 0,
          stepLimitTriggered: false,
          generationOutcome: "pending",
        }
      : undefined;
    let root: LangfuseSpan | undefined;
    let finished = false;
    let markFinished: () => void = () => {};
    const finalized = new Promise<void>((resolve) => {
      markFinished = resolve;
    });
    const turnStarted = requestStarted;
    const finish = (
      outcome: string,
      assistantId?: string,
      assistantText?: string,
      streamStatus?: string,
    ) => {
      if (!root || finished) return;
      finished = true;
      try {
        root.update({
          output: assistantText ?? "[unavailable]",
          metadata: {
            captureSchemaVersion: 1,
            requestId,
            schoolId: school.id,
            userMessageId: body.message?.id,
            assistantMessageId: assistantId,
            contextLoadMs,
            durationMs: Date.now() - turnStarted,
            generationOutcome: trace?.generationOutcome,
            streamOutcome:
              streamStatus ??
              (outcome === "pre_stream_failed" ? "not_started" : "unknown"),
            persistenceOutcome:
              outcome === "persisted"
                ? "complete"
                : outcome === "persistence_failed"
                  ? "failed"
                  : "not_attempted",
            stepCount: trace?.stepCount,
            stepLimitTriggered: trace?.stepLimitTriggered,
            finishReason: trace?.finishReason,
            promptHash: digest(prompt),
            schoolConfigurationHash: digest(
              JSON.stringify({ school, faqs: catalog.faqs }),
            ),
            release: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
            deploymentEnvironment: process.env.VERCEL_ENV ?? "local",
          },
          level:
            outcome === "persisted" && streamStatus === "complete"
              ? "DEFAULT"
              : "ERROR",
        });
        root.end();
      } catch {
        console.error(
          JSON.stringify({
            event: "turn_trace_finalize_failed",
            requestId,
            conversationId: conversation.id,
          }),
        );
        try {
          root.end();
        } catch {
          /* telemetry cannot fail the chat */
        }
      } finally {
        markFinished();
      }
      console.info(
        JSON.stringify({
          event: "turn_finished",
          requestId,
          traceId: root.traceId,
          conversationId: conversation.id,
          outcome,
        }),
      );
    };
    if (runtime)
      console.info(
        JSON.stringify({
          event: "turn_started",
          requestId,
          conversationId: conversation.id,
        }),
      );

    await db.insert(messages).values({
      conversationId: conversation.id,
      messageId: body.message.id,
      role: "user",
      parts: body.message.parts,
      completion: "complete",
      purgeAt,
    });

    const persistAssistant = async ({
      responseMessage,
      isAborted,
      outcome,
    }: {
      responseMessage: UIMessage;
      isAborted: boolean;
      outcome: { status: string };
    }) => {
      const completion =
        isAborted || outcome.status === "aborted"
          ? "aborted"
          : outcome.status === "failed"
            ? "error"
            : "complete";
      try {
        await db.insert(messages).values({
          conversationId: conversation.id,
          messageId: responseMessage.id,
          role: "assistant",
          parts: responseMessage.parts,
          completion,
          purgeAt,
        });
        await releaseLock();
        finish(
          "persisted",
          responseMessage.id,
          textFromMessage(responseMessage),
          completion,
        );
      } catch (error) {
        try {
          await releaseLock();
        } catch {
          console.error(
            JSON.stringify({
              event: "turn_lock_release_failed",
              requestId,
              conversationId: conversation.id,
            }),
          );
        }
        finish(
          "persistence_failed",
          responseMessage.id,
          textFromMessage(responseMessage),
          completion,
        );
        throw error;
      }
    };

    if (isLocalAiStub()) {
      const offeringNames = catalog.offerings
        .filter((offering) => offering.active)
        .map((offering) => offering.name);
      const stubText =
        offeringNames.length > 0
          ? `Local chat stub (no VERCEL_OIDC_TOKEN). ${school.name} offers ${offeringNames.join(", ")}. Use Book Trial to confirm a slot.`
          : `Local chat stub (no VERCEL_OIDC_TOKEN). Use Book Trial on this page to pick a time at ${school.name}.`;
      return createUIMessageStreamResponse({
        stream: createUIMessageStream({
          originalMessages: uiMessages as never,
          generateId,
          execute: ({ writer }) => {
            writer.write({ type: "text-start", id: "stub" });
            writer.write({
              type: "text-delta",
              id: "stub",
              delta: stubText,
            });
            writer.write({ type: "text-end", id: "stub" });
          },
          onEnd: persistAssistant,
        }),
      });
    }

    let agentStarted = false;
    const streamResponse = () => {
      const agent = createBookingAgent({
        school,
        offerings: catalog.offerings,
        windows: catalog.windows,
        occurrences: catalog.occurrences,
        faqs: catalog.faqs,
        now,
        trace,
      });
      agentStarted = true;
      return createAgentUIStreamResponse({
        agent,
        uiMessages: uiMessages as never,
        originalMessages: uiMessages as never,
        generateMessageId: generateId,
        headers: runtime ? { "x-chat-request-id": requestId } : undefined,
        consumeSseStream: async ({ stream }) => {
          await stream.pipeTo(new WritableStream({ write() {} }));
        },
        onError: () => {
          if (trace) trace.generationOutcome = "failed";
          return `Chat failed (request ${requestId}).`;
        },
        onEnd: persistAssistant,
      });
    };
    if (!runtime) return streamResponse();
    after(async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        finalized,
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            console.warn(
              JSON.stringify({
                event: "turn_outcome_unknown",
                requestId,
                conversationId: conversation.id,
              }),
            );
            resolve();
          }, 25_000);
        }),
      ]);
      if (timer) clearTimeout(timer);
      await flushCapture();
    });
    try {
      return await propagateAttributes(
        {
          sessionId: conversation.id,
          traceName: "booking-chat.turn",
          metadata: {
            debugCapture: "true",
            schoolId: school.id,
            requestId,
            channel: "web",
            captureSchemaVersion: "1",
          },
        },
        () =>
          startActiveObservation(
            "booking-chat.turn",
            async (span) => {
              root = span;
              console.info(
                JSON.stringify({
                  event: "turn_trace_started",
                  requestId,
                  traceId: span.traceId,
                  conversationId: conversation.id,
                }),
              );
              try {
                span.update({
                  input: userText,
                  metadata: {
                    requestId,
                    userMessageId: body.message?.id,
                    schoolId: school.id,
                    contextLoadMs,
                  },
                });
              } catch {
                console.error(
                  JSON.stringify({
                    event: "turn_trace_start_failed",
                    requestId,
                    conversationId: conversation.id,
                  }),
                );
                try {
                  span.end();
                } catch {
                  /* telemetry cannot fail chat */
                }
                root = undefined;
                trace = undefined;
                markFinished();
              }
              return streamResponse();
            },
            { endOnExit: false },
          ),
      );
    } catch (error) {
      if (!root && !agentStarted) {
        console.error(
          JSON.stringify({
            event: "turn_trace_start_failed",
            requestId,
            conversationId: conversation.id,
          }),
        );
        trace = undefined;
        markFinished();
        return streamResponse();
      }
      if (trace) trace.generationOutcome = "failed";
      finish("pre_stream_failed");
      throw error;
    }
  } catch (error) {
    await releaseLock();
    throw error;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug");
  const resumeToken =
    request.headers.get("x-debug-resume-token") ??
    url.searchParams.get("resumeToken");
  const preview = url.searchParams.get("preview") === "1";
  if (!slug || !resumeToken) {
    return Response.json({ error: "invalid" }, { status: 400 });
  }
  const school = await getSchoolForLandingAccess(slug, { preview });
  if (!school) return Response.json({ error: "not_found" }, { status: 404 });
  if (resumeToken.startsWith("dbg_")) {
    const ownerId = await debugOwner(school);
    const context = request.headers.get("x-debug-context");
    if (
      !ownerId ||
      !context ||
      !verifyDebugContext(context, school.id, ownerId, resumeToken)
    ) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
  }
  const db = getDb();
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.schoolId, school.id),
        eq(conversations.resumeTokenHash, hashToken(resumeToken)),
      ),
    )
    .limit(1);
  if (!conversation) return Response.json({ messages: [] });
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversation.id))
    .orderBy(asc(messages.createdAt));
  return Response.json({
    messages: rows.map((row) => ({
      id: row.messageId,
      role: row.role,
      parts: row.parts,
    })),
  });
}
