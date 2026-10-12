import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/dashboard/page-header";
import { requireOwnedSchool } from "@/lib/auth/current-school";
import { ChannelLabel, ContactDetails } from "../conversation-details";
import { ConversationTranscript } from "../conversation-transcript";
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
      <ConversationTranscript
        conversation={conversation}
        timezone={school.timezone}
      />
    </main>
  );
}
