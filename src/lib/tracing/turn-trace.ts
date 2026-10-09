import {
  type LangfuseSpanAttributes,
  propagateAttributes,
  startObservation,
} from "@langfuse/tracing";
import { context, ROOT_CONTEXT, trace } from "@opentelemetry/api";
import type { Channel } from "@/lib/channel";

export type TurnTraceStart = {
  channel: Channel;
  conversationId: string;
  schoolId: string;
  /** The id of the inbound message's saved row. */
  inboundMessageId: string;
  inboundText: string;
};

export type TurnReply = {
  text: string;
  /**
   * The id of the reply's saved row. Absent when the reply was sent but not
   * saved as a message.
   */
  messageId?: string;
  /** How the saved reply ended, where it can end short of complete. */
  completion?: "complete" | "aborted" | "error";
  /** What the reply came from, when the assistant wrote it. */
  provenance?: { modelId: string; platformInstructionsHash: string };
};

export type TurnTrace = {
  /**
   * Runs `work` as part of the turn: the spans it starts nest under the turn,
   * and if it throws, the turn ends as failed.
   */
  run<T>(work: () => Promise<T>): Promise<T>;
  /** Ends the turn with its reply, once the turn has settled. */
  end(reply: TurnReply): void;
  /**
   * Exports the turn's trace once the turn has ended, waiting at most
   * END_TIMEOUT_MS. Never rejects: a failed export is only logged.
   */
  exportWhenEnded(): Promise<void>;
};

const TRACE_NAME = "turn";

// A reply saved short of complete flags its turn, so a failure never looks
// like a clean turn.
const LEVEL_BY_COMPLETION = {
  complete: undefined,
  aborted: "WARNING",
  error: "ERROR",
} as const satisfies Record<
  NonNullable<TurnReply["completion"]>,
  LangfuseSpanAttributes["level"]
>;

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

  // A turn ends once: with its reply, or as failed when work run in it throws,
  // whichever comes first.
  const ended = Promise.withResolvers<void>();
  let hasEnded = false;
  const endRoot = (attributes: LangfuseSpanAttributes) => {
    if (hasEnded) return;
    hasEnded = true;
    root.update(attributes);
    root.end();
    ended.resolve();
  };

  return {
    run(work) {
      return context.with(turnContext, async () => {
        try {
          return await work();
        } catch (error) {
          endRoot({ level: "ERROR", statusMessage: failureMessage(error) });
          throw error;
        }
      });
    },
    end({ text, messageId, completion, provenance }) {
      endRoot({
        output: text,
        level: completion && LEVEL_BY_COMPLETION[completion],
        metadata: {
          replyMessageId: messageId,
          completion,
          modelId: provenance?.modelId,
          platformInstructionsHash: provenance?.platformInstructionsHash,
        },
      });
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
  // Flushes through the global tracer provider, not a module-level reference
  // to what registerTracing made: Next bundles instrumentation and routes
  // separately, so such a reference isn't reliably shared. The provider sits
  // behind the API's proxy, and is duck-typed because the SDK and the API may
  // come from different package copies.
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
