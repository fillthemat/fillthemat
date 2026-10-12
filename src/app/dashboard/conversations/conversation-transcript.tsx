import { formatOwnerDateTime } from "@/components/dashboard/format";
import type { loadConversation } from "./queries";

type Conversation = NonNullable<Awaited<ReturnType<typeof loadConversation>>>;

export function ConversationTranscript({
  conversation,
  timezone,
}: {
  conversation: Conversation;
  timezone: string;
}) {
  const timeline = [
    ...conversation.messages.map((message) => ({
      ...message,
      kind: "message" as const,
      order: message.role === "user" ? 0 : 2,
    })),
    ...conversation.bookingIntents.map((intent) => ({
      ...intent,
      kind: "booking-intent" as const,
      order: 1,
    })),
  ].sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.order - b.order ||
      a.id.localeCompare(b.id),
  );

  if (timeline.length === 0) {
    return <p className="text-sm text-muted-foreground">No messages yet.</p>;
  }

  return (
    <ol
      aria-label="Conversation transcript"
      className="flex max-w-3xl flex-col gap-3"
    >
      {timeline.map((entry) => (
        <li
          key={`${entry.kind}-${entry.id}`}
          className={
            entry.kind === "booking-intent"
              ? "flex flex-col gap-1 self-center rounded-md border border-border px-4 py-2"
              : entry.role === "user"
                ? "flex flex-col gap-1 self-end rounded-xl bg-muted p-4"
                : "flex flex-col gap-1 self-start rounded-xl border border-border p-4"
          }
        >
          {entry.kind === "booking-intent" ? (
            <p className="text-sm font-medium">Booking Intent created</p>
          ) : (
            <>
              <p className="text-xs font-medium text-muted-foreground">
                {entry.role === "user" ? "Contact" : "Assistant"}
              </p>
              <p className="whitespace-pre-wrap text-sm break-words">
                {entry.text || "No text content."}
              </p>
            </>
          )}
          <time
            dateTime={entry.createdAt.toISOString()}
            className="text-xs text-muted-foreground"
          >
            {formatOwnerDateTime(entry.createdAt, timezone)}
          </time>
        </li>
      ))}
    </ol>
  );
}
