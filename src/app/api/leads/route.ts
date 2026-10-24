import { attemptPendingForLead } from "@/lib/email/deliveries";
import { createLead, ownerLeadQuotaExceeded } from "@/lib/leads/create-lead";
import { getRequestIp } from "@/lib/request";
import { getPublicSchoolBySlug } from "@/lib/schools/public";
import { requestBodyTooLarge } from "@/lib/security/limits";
import { verifyTurnstile } from "@/lib/security/turnstile";
import { leadRequestSchema } from "@/lib/validation";

export async function POST(request: Request) {
  if (requestBodyTooLarge(request.headers.get("content-length"))) {
    return Response.json({ error: "too_large" }, { status: 413 });
  }
  const parsed = leadRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "invalid" }, { status: 400 });
  }
  const body = parsed.data;
  const school = await getPublicSchoolBySlug(body.schoolSlug);
  if (!school) return Response.json({ error: "not_found" }, { status: 404 });

  const ip = getRequestIp(request.headers);
  if (!(await verifyTurnstile(body.turnstileToken, ip))) {
    return Response.json({ error: "verification_failed" }, { status: 403 });
  }
  if (await ownerLeadQuotaExceeded(school.id)) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  const lead = await createLead({
    school,
    contact: body.contact,
    source: { channel: "web", landingSessionToken: body.landingSessionToken },
    participantName: body.participantName,
    participantAge: body.participantAge,
    offeringId: body.offeringId,
    statedNeed: body.statedNeed,
  });

  await attemptPendingForLead(lead.id);
  return Response.json({ ok: true, leadId: lead.id });
}
