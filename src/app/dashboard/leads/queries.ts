import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { contacts, leads, poppyClients } from "@/db/schema";

export function loadLeads(schoolId: string) {
  return getDb()
    .select({
      lead: leads,
      contact: contacts,
      poppyClientDisplayName: poppyClients.displayName,
    })
    .from(leads)
    .innerJoin(contacts, eq(leads.contactId, contacts.id))
    .leftJoin(poppyClients, eq(leads.poppyClientId, poppyClients.clientId))
    .where(eq(leads.schoolId, schoolId))
    .orderBy(desc(leads.createdAt));
}
