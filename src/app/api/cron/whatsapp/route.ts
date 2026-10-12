import { randomUUID } from "node:crypto";
import { cronSecretMatches } from "@/lib/request";
import { createWhatsAppConnection } from "@/lib/whatsapp/connection";
import {
  RELEASE_BATCH_SIZE,
  RELEASE_SWEEP_BUDGET_MS,
} from "@/lib/whatsapp/lifecycle";
import { runWhatsAppWorkerOnce } from "@/lib/whatsapp/worker";

export const maxDuration = 300;

export async function GET(request: Request) {
  if (!cronSecretMatches(request.headers.get("authorization"))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const [result, releases] = await Promise.all([
    runWhatsAppWorkerOnce(randomUUID()),
    createWhatsAppConnection().releaseDue(RELEASE_BATCH_SIZE, {
      deadline: new Date(Date.now() + RELEASE_SWEEP_BUDGET_MS),
    }),
  ]);
  return Response.json({ ...result, releases });
}
