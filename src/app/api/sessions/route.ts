import { recordLandingSession } from "@/lib/sessions/record-session";
import { landingSessionRequestSchema } from "@/lib/validation";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid" }, { status: 400 });
  }
  const parsed = landingSessionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid" }, { status: 400 });
  }

  const result = await recordLandingSession({
    ...parsed.data,
    userAgent: request.headers.get("user-agent"),
  });
  switch (result.status) {
    case "not_found":
      return Response.json({ error: "not_found" }, { status: 404 });
    case "recorded":
      return Response.json({ ok: true, qualified: result.qualified });
  }
}
