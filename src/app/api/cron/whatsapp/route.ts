import { randomUUID } from "node:crypto";
import { cronSecretMatches } from "@/lib/request";
import { runWhatsAppWorkerOnce } from "@/lib/whatsapp/worker";

export const maxDuration = 300;

export async function GET(request: Request) {
  if (!cronSecretMatches(request.headers.get("authorization"))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runWhatsAppWorkerOnce(randomUUID());
  return Response.json(result);
}
