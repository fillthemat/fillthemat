import { createHmac, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/webhooks/whatsapp/route";
import { getDb } from "@/db";
import {
  conversations,
  messages,
  schools,
  trialOfferings,
  users,
  whatsappDeliveries,
  whatsappJobs,
} from "@/db/schema";
import { WHATSAPP_STUB_APP_SECRET } from "@/lib/whatsapp/config";
import { runWhatsAppWorkerOnce } from "@/lib/whatsapp/worker";
import {
  authSql,
  deleteAuthUser,
  insertAuthUser,
  loadLocalEnv,
} from "@/test/integration-env";

loadLocalEnv();

const db = getDb();
const sql = authSql();
const suffix = randomUUID().slice(0, 8);
const ownerId = randomUUID();
const phoneNumberId = `399${Date.now().toString().slice(-9)}`;
const waId = "16505557777";
let schoolId = "";

function textMessage(wamid: string, text: string): Request {
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "test-waba",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: phoneNumberId },
              contacts: [{ profile: { name: "Alex Rivera" }, wa_id: waId }],
              messages: [
                {
                  from: waId,
                  id: wamid,
                  timestamp: "1690000000",
                  type: "text",
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  });
  const signature = createHmac("sha256", WHATSAPP_STUB_APP_SECRET)
    .update(body)
    .digest("hex");
  return new Request("http://127.0.0.1:3000/api/webhooks/whatsapp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": `sha256=${signature}`,
    },
    body,
  });
}

beforeAll(async () => {
  await insertAuthUser(sql, ownerId, `wa-as-${suffix}@local.test`);
  await db.insert(users).values({
    id: ownerId,
    email: `wa-as-${suffix}@local.test`,
    name: "WA Assistant Owner",
  });
  const [school] = await db
    .insert(schools)
    .values({
      ownerUserId: ownerId,
      name: "WhatsApp Assistant School",
      slug: `wa-as-${suffix}`,
      timezone: "America/New_York",
      notificationEmail: `wa-as-${suffix}@local.test`,
      whatsappPhoneNumberId: phoneNumberId,
      approvedAt: new Date(),
    })
    .returning({ id: schools.id });
  if (!school) throw new Error("failed to seed school");
  schoolId = school.id;
  await db.insert(trialOfferings).values([
    { schoolId, name: "Kids BJJ", minimumAge: 5, maximumAge: 12 },
    { schoolId, name: "Adult Muay Thai", active: false },
  ]);
});

afterAll(async () => {
  await db
    .delete(whatsappJobs)
    .where(eq(whatsappJobs.phoneNumberId, phoneNumberId));
  await db.delete(users).where(eq(users.id, ownerId));
  await deleteAuthUser(sql, ownerId);
  await sql.end({ timeout: 5 });
});

describe("a WhatsApp turn with no AI Gateway token", () => {
  it("is answered by the assistant's scripted local model, naming the school's active trial offerings", async () => {
    const response = await POST(
      textMessage(`wamid.assistant.${suffix}`, "What can my son try?"),
    );
    expect(response.status).toBe(200);

    await runWhatsAppWorkerOnce(randomUUID());

    const reply =
      "Local scripted reply (no AI Gateway token). Trial offerings: Kids BJJ.";
    const saved = await db
      .select({ role: messages.role, parts: messages.parts })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(eq(conversations.schoolId, schoolId));
    expect(
      saved.filter((row) => row.role === "assistant").map((row) => row.parts),
    ).toEqual([[{ type: "text", text: reply }]]);
    const sent = await db
      .select({ body: whatsappDeliveries.body })
      .from(whatsappDeliveries)
      .where(eq(whatsappDeliveries.schoolId, schoolId));
    expect(sent).toEqual([{ body: reply }]);
  });
});
