import { randomUUID } from "node:crypto";
import { cronSecretMatches } from "@/lib/request";
import { createWhatsAppConnection } from "@/lib/whatsapp/connection";
import { runWhatsAppWorkerOnce } from "@/lib/whatsapp/worker";

export const maxDuration = 300;

export async function GET(request: Request) {
  if (!cronSecretMatches(request.headers.get("authorization"))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const [result, releases] = await Promise.all([
    runWhatsAppWorkerOnce(randomUUID()),
    createWhatsAppConnection().releaseDue(25, {
      deadline: new Date(Date.now() + 4 * 60_000),
    }),
  ]);
  return Response.json({ ...result, releases });
}
