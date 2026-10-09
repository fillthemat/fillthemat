import {
  type LangfuseSpanAttributes,
  propagateAttributes,
  startObservation,
} from "@langfuse/tracing";
import { context, ROOT_CONTEXT, trace } from "@opentelemetry/api";

/** The medium a conversation happens over. */
export type Channel = "web" | "whatsapp";

export type TurnTraceStart = {
  channel: Channel;
  conversationId: string;
  schoolId: string;
  inboundMessageId: string;
  inboundText: string;
};

export type TurnReply = {
  /** Absent when the reply was sent but not saved as a message. */
  replyMessageId?: string;
  replyText: string;
  /** What the reply came from, when the assistant wrote it. */
  assistant?: { modelId: string; platformInstructionsHash: string };
};

export type TurnTrace = {
  /**
   * Runs `work` as part of the turn: the spans it starts nest under the turn,
   * and if it throws, the turn ends as failed.
   */
  run<T>(work: () => Promise<T>): Promise<T>;
  /** Ends the turn with its reply, once the turn has settled. */
  end(reply: TurnReply): void;
  /** Ends the turn as failed. */
  fail(error: unknown): void;
  /**
   * Exports the turn's trace once the turn has ended, waiting at most
   * END_TIMEOUT_MS. Never rejects: a failed export is only logged.
   */
  exportWhenEnded(): Promise<void>;
};

const TRACE_NAME = "turn";

// Long enough for a full assistant turn, and well under the platform's
// default function duration, so a turn that never ends still has its finished
// spans exported.
const END_TIMEOUT_MS = 120_000;
const EXPORT_TIMEOUT_MS = 10_000;

/**
 * Starts the trace of one turn: one inbound message and the reply to it. In
 * Langfuse the trace belongs to the conversation's session and to the school,
 * and is tagged with the channel.
 */
export function startTurnTrace({
  channel,
  conversationId,
  schoolId,
  inboundMessageId,
  inboundText,
}: TurnTraceStart): TurnTrace {
  // Each turn is its own trace, never a child of whatever span is active.
  const root = context.with(ROOT_CONTEXT, () =>
    startObservation(TRACE_NAME, {
      input: inboundText,
      metadata: { inboundMessageId },
    }),
  );
  // Spans started in this context nest under the root and carry the session,
  // user and tags.
  const turnContext = context.with(
    trace.setSpan(ROOT_CONTEXT, root.otelSpan),
    () =>
      propagateAttributes(
        {
          sessionId: conversationId,
          userId: schoolId,
          tags: [channel],
          traceName: TRACE_NAME,
        },
        () => context.active(),
      ),
  );

  // A turn ends once: whichever of end and fail comes first.
  const ended = Promise.withResolvers<void>();
  let hasEnded = false;
  const endRoot = (attributes: LangfuseSpanAttributes) => {
    if (hasEnded) return;
    hasEnded = true;
    root.update(attributes);
    root.end();
    ended.resolve();
  };

  const turn: TurnTrace = {
    run(work) {
      return context.with(turnContext, async () => {
        try {
          return await work();
        } catch (error) {
          turn.fail(error);
          throw error;
        }
      });
    },
    end({ replyMessageId, replyText, assistant }) {
      endRoot({
        output: replyText,
        metadata: {
          replyMessageId,
          modelId: assistant?.modelId,
          platformInstructionsHash: assistant?.platformInstructionsHash,
        },
      });
    },
    fail(error) {
      endRoot({ level: "ERROR", statusMessage: failureMessage(error) });
    },
    async exportWhenEnded() {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const endedInTime = await Promise.race([
        ended.promise.then(() => true),
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), END_TIMEOUT_MS);
        }),
      ]);
      clearTimeout(timer);
      if (!endedInTime) {
        console.warn("tracing: exporting a turn that has not ended");
      }
      await exportEndedTurns();
    },
  };
  return turn;
}

// The innermost cause says what actually went wrong, e.g. the database error
// under a failed query.
function failureMessage(error: unknown): string {
  let cause = error;
  while (cause instanceof Error && cause.cause !== undefined) {
    cause = cause.cause;
  }
  return cause instanceof Error
    ? `${cause.name}: ${cause.message}`
    : String(cause);
}

type FlushableTracerProvider = {
  forceFlush?: (options?: { timeoutMillis?: number }) => Promise<void>;
};

/**
 * Exports the traces of every turn that has ended so far. Never rejects: a
 * failed export is only logged. Without Langfuse keys there is nothing to
 * export.
 */
export async function exportEndedTurns(): Promise<void> {
  // The registered provider sits behind the API's proxy. It's duck-typed
  // because the SDK and the API may come from different package copies.
  const proxy = trace.getTracerProvider() as { getDelegate?: () => unknown };
  const provider = (proxy.getDelegate?.() ?? proxy) as FlushableTracerProvider;
  if (typeof provider.forceFlush !== "function") return;
  try {
    await provider.forceFlush({ timeoutMillis: EXPORT_TIMEOUT_MS });
  } catch (failure) {
    // Rejects with a list of errors. Log what went wrong, never the spans.
    console.error(
      "tracing: export failed",
      [failure]
        .flat()
        .map((error) =>
          error instanceof Error
            ? `${error.name}: ${error.message}`
            : "unknown",
        ),
    );
  }
}
