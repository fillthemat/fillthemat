import { formatOwnerDate } from "@/components/dashboard/format";
import { PageHeader } from "@/components/dashboard/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { loadLeads } from "./queries";

export default async function LeadsPage() {
  const { leads, timezone } = await loadLeads();

  return (
    <main id="main-content" className="flex flex-col gap-4">
      <PageHeader title="Leads" />
      {leads.length === 0 ? (
        <p className="text-sm text-muted-foreground">No leads yet.</p>
      ) : (
        <Table aria-label="Leads">
          <TableHeader>
            <TableRow>
              <TableHead>Contact</TableHead>
              <TableHead>Participant</TableHead>
              <TableHead>Enquiry</TableHead>
              <TableHead>Received</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.map((lead) => {
              const contact = lead.contacts;
              const participant = [
                lead.participant_name,
                lead.participant_age != null ? `(age ${lead.participant_age})` : null,
              ]
                .filter(Boolean)
                .join(" ");

              return (
                <TableRow key={lead.id}>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <p className="font-medium text-pretty">{contact.name}</p>
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
                    </div>
                  </TableCell>
                  <TableCell className="text-pretty">{participant || "—"}</TableCell>
                  <TableCell className="text-pretty wrap-break-word">
                    {lead.stated_need || "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatOwnerDate(new Date(lead.created_at), timezone)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </main>
  );
}
