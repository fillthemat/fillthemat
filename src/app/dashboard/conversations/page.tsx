import Link from "next/link";
import { formatOwnerDateTime } from "@/components/dashboard/format";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireOwnedSchool } from "@/lib/auth/current-school";
import { ChannelLabel, ContactDetails } from "./conversation-details";
import { conversationFiltersSchema, loadConversations } from "./queries";

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ school }, params] = await Promise.all([
    requireOwnedSchool(),
    searchParams,
  ]);
  const filters = conversationFiltersSchema.safeParse({
    from: params.from || undefined,
    to: params.to || undefined,
    contact: params.contact,
  });
  const rows = filters.success
    ? await loadConversations(school.id, filters.data)
    : [];
  const hasFilters = Boolean(params.from || params.to || params.contact);

  return (
    <main id="main-content" className="flex flex-col gap-4">
      <PageHeader title="Conversations" />
      <p className="text-sm text-muted-foreground">
        Read your Assistant's conversations. You cannot reply here.
      </p>
      <form
        action="/dashboard/conversations"
        method="get"
        className="flex flex-wrap items-end gap-3"
        aria-label="Conversation filters"
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor="from">Start date</Label>
          <Input
            id="from"
            name="from"
            type="date"
            defaultValue={typeof params.from === "string" ? params.from : ""}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="to">End date</Label>
          <Input
            id="to"
            name="to"
            type="date"
            defaultValue={typeof params.to === "string" ? params.to : ""}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="contact">Contact</Label>
          <Input
            id="contact"
            name="contact"
            type="search"
            maxLength={200}
            placeholder="Name, email, or phone"
            defaultValue={
              typeof params.contact === "string" ? params.contact : ""
            }
          />
        </div>
        <Button type="submit">Apply filters</Button>
        <Link
          href="/dashboard/conversations"
          className="text-sm underline-offset-4 hover:underline"
        >
          Clear filters
        </Link>
      </form>
      <p className="text-xs text-muted-foreground">
        Dates include conversations started on those days in {school.timezone}.
      </p>
      {!filters.success ? (
        <p role="alert" className="text-sm text-destructive">
          Enter valid dates with the start on or before the end, and a contact
          search of at most 200 characters.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {hasFilters
            ? "No conversations match these filters."
            : "No conversations yet."}
        </p>
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
