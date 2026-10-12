import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { contacts, leads } from "@/db/schema";

export function loadLeads(schoolId: string) {
  return getDb()
    .select({ lead: leads, contact: contacts })
    .from(leads)
    .innerJoin(contacts, eq(leads.contactId, contacts.id))
    .where(eq(leads.schoolId, schoolId))
    .orderBy(desc(leads.createdAt));
}
