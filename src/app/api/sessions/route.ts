import { recordLandingSession } from "@/lib/sessions/record-session";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    slug?: string;
    token?: string;
    preview?: boolean;
    utm?: Record<string, string | undefined>;
  };
  if (!body.slug || !body.token || body.token.length < 16) {
    return Response.json({ error: "invalid" }, { status: 400 });
  }

  const result = await recordLandingSession({
    ...body,
    slug: body.slug,
    token: body.token,
    userAgent: request.headers.get("user-agent"),
  });
  switch (result.status) {
    case "not_found":
      return Response.json({ error: "not_found" }, { status: 404 });
    case "recorded":
      return Response.json({ ok: true, qualified: result.qualified });
  }
}
