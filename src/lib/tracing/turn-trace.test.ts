import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { exportedTraces } from "@/test/tracing";
import { startTurnTrace } from "./turn-trace";

describe("a turn whose reply was saved short of complete", () => {
  it.each([
    { completion: "error", level: "ERROR" },
    { completion: "aborted", level: "WARNING" },
  ] as const)(
    "is flagged at level $level when the reply was saved as $completion",
    async ({ completion, level }) => {
      const replyMessageId = randomUUID();
      const turn = startTurnTrace({
        channel: "web",
        conversationId: randomUUID(),
        schoolId: randomUUID(),
        inboundMessageId: randomUUID(),
        inboundText: "What can my son try?",
      });

      turn.end({ replyText: "We offer", replyMessageId, completion });

      expect(await exportedTraces()).toEqual([
        expect.objectContaining({
          output: "We offer",
          level,
          metadata: expect.objectContaining({ replyMessageId, completion }),
        }),
      ]);
    },
  );
});
