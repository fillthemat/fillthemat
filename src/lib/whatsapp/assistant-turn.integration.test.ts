import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/webhooks/whatsapp/route";
import { getDb } from "@/db";
import {
  conversations,
  messages,
  whatsappDeliveries,
  whatsappJobs,
} from "@/db/schema";
import { authSql, loadLocalEnv } from "@/test/integration-env";
import { deleteSchoolOwner, seedSchool } from "@/test/seed-school";
import { post, textInboundPayload } from "@/test/whatsapp-webhook";
import { scopedWhatsAppRunner } from "@/test/whatsapp-worker";

loadLocalEnv();

const db = getDb();
const sql = authSql();
const suffix = randomUUID().slice(0, 8);
const ownerId = randomUUID();
const phoneNumberId = `399${Date.now().toString().slice(-9)}`;
const { runWhatsAppWorkerOnce } = scopedWhatsAppRunner(() => [phoneNumberId]);
const waId = "16505557777";
let schoolId = "";

beforeAll(async () => {
  const seeded = await seedSchool(sql, {
    ownerId,
    name: "WhatsApp Assistant School",
    slug: `wa-as-${suffix}`,
    whatsappPhoneNumberId: phoneNumberId,
    offerings: [
      { name: "Kids BJJ", minimumAge: 5, maximumAge: 12 },
      { name: "Adult Muay Thai", active: false },
    ],
  });
  schoolId = seeded.schoolId;
});

afterAll(async () => {
  await db
    .delete(whatsappJobs)
    .where(eq(whatsappJobs.phoneNumberId, phoneNumberId));
  await deleteSchoolOwner(sql, ownerId);
  await sql.end({ timeout: 5 });
});

describe("a WhatsApp turn with no AI Gateway token", () => {
  it("is answered by the assistant's scripted local model, naming the school's active trial offerings", async () => {
    const response = await POST(
      post(
        textInboundPayload({
          phoneNumberId,
          waId,
          wamid: `wamid.assistant.${suffix}`,
          text: "What can my son try?",
        }),
      ),
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

  it("processes an immediate message and sends its reply when the worker clock trails the database", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(Date.now() - 60_000));
      const recipient = "16505557778";
      await POST(
        post(
          textInboundPayload({
            phoneNumberId,
            waId: recipient,
            wamid: `wamid.clock.${suffix}`,
            text: "What can my son try?",
          }),
        ),
      );
      await runWhatsAppWorkerOnce(randomUUID());
      const sent = await db
        .select({
          body: whatsappDeliveries.body,
          state: whatsappDeliveries.state,
        })
        .from(whatsappDeliveries)
        .where(eq(whatsappDeliveries.recipientWaId, recipient));
      expect(sent).toEqual([
        {
          body: "Local scripted reply (no AI Gateway token). Trial offerings: Kids BJJ.",
          state: "sent",
        },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
