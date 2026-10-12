import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { formatOwnerDateTime } from "@/components/dashboard/format";
import { PageHeader } from "@/components/dashboard/page-header";
import { requireOwnedSchool } from "@/lib/auth/current-school";
import { ChannelLabel, ContactDetails } from "../conversation-details";
import { loadConversation } from "../queries";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const [{ school }, { conversationId }] = await Promise.all([
    requireOwnedSchool(),
    params,
  ]);
  if (!z.uuid().safeParse(conversationId).success) notFound();
  const conversation = await loadConversation(school.id, conversationId);
  if (!conversation) notFound();

  return (
    <main id="main-content" className="flex flex-col gap-4">
      <PageHeader title="Conversation" />
      <Link
        href="/dashboard/conversations"
        className="w-fit text-sm underline-offset-4 hover:underline"
      >
        Back to conversations
      </Link>
      <ContactDetails contact={conversation.contact} />
      <p className="text-sm text-muted-foreground">
        <ChannelLabel channel={conversation.channel} /> · Read-only · Times in{" "}
        {school.timezone}
      </p>
      {conversation.messages.length === 0 ? (
        <p className="text-sm text-muted-foreground">No messages yet.</p>
      ) : (
        <ol
          aria-label="Conversation transcript"
          className="flex max-w-3xl flex-col gap-3"
        >
          {conversation.messages.map((message) => (
            <li
              key={message.id}
              className={
                message.role === "user"
                  ? "flex flex-col gap-1 self-end rounded-xl bg-muted p-4"
                  : "flex flex-col gap-1 self-start rounded-xl border border-border p-4"
              }
            >
              <p className="text-xs font-medium text-muted-foreground">
                {message.role === "user" ? "Contact" : "Assistant"}
              </p>
              <p className="whitespace-pre-wrap text-sm break-words">
                {message.text || "No text content."}
              </p>
              <time
                dateTime={message.createdAt.toISOString()}
                className="text-xs text-muted-foreground"
              >
                {formatOwnerDateTime(message.createdAt, school.timezone)}
              </time>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
