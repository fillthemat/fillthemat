import { formatChannel, formatOwnerDate } from "@/components/dashboard/format";
import { PageHeader } from "@/components/dashboard/page-header";
import { requireOwnedSchool } from "@/lib/auth/current-school";
import { loadLeads } from "./queries";

export default async function LeadsPage() {
  const { school } = await requireOwnedSchool();
  const rows = await loadLeads(school.id);

  return (
    <main id="main-content" className="flex flex-col gap-4">
      <PageHeader title="Leads" />
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No leads yet.</p>
      ) : (
        <ul className="divide-y divide-border border-y border-border">
          {rows.map(({ lead, contact }) => {
            const participant = [
              lead.participantName,
              lead.participantAge != null
                ? `(age ${lead.participantAge})`
                : null,
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <li key={lead.id} className="flex flex-col gap-1 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="font-medium text-pretty">{contact.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatOwnerDate(lead.createdAt, school.timezone)}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Channel: {formatChannel(lead.channel)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {contact.email ? (
                    <a
                      href={`mailto:${contact.email}`}
                      className="break-all underline-offset-4 hover:underline"
                    >
                      {contact.email}
                    </a>
                  ) : null}
                  {contact.email && contact.phone ? " · " : null}
                  {contact.phone ? (
                    <a
                      href={`tel:${contact.phone}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {contact.phone}
                    </a>
                  ) : null}
                </p>
                {participant ? (
                  <p className="text-sm text-pretty">{participant}</p>
                ) : null}
                {lead.statedNeed ? (
                  <p className="text-sm text-pretty break-words">
                    {lead.statedNeed}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
