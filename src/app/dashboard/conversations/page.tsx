import Link from "next/link";
import { formatOwnerDateTime } from "@/components/dashboard/format";
import { PageHeader } from "@/components/dashboard/page-header";
import { requireOwnedSchool } from "@/lib/auth/current-school";
import { ChannelLabel, ContactDetails } from "./conversation-details";
import { loadConversations } from "./queries";

export default async function ConversationsPage() {
  const { school } = await requireOwnedSchool();
  const rows = await loadConversations(school.id);

  return (
    <main id="main-content" className="flex flex-col gap-4">
      <PageHeader title="Conversations" />
      <p className="text-sm text-muted-foreground">
        Read your Assistant's conversations. You cannot reply here.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No conversations yet.</p>
      ) : (
        <ul className="divide-y divide-border border-y border-border">
          {rows.map((conversation) => (
            <li key={conversation.id}>
              <Link
                href={`/dashboard/conversations/${conversation.id}`}
                className="flex flex-col gap-2 rounded-md px-2 py-3 transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/70"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <ChannelLabel channel={conversation.channel} />
                  <time dateTime={conversation.createdAt.toISOString()}>
                    {formatOwnerDateTime(
                      conversation.createdAt,
                      school.timezone,
                    )}
                  </time>
                </div>
                <ContactDetails contact={conversation.contact} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
