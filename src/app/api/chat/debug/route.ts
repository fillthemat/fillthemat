import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { conversations } from "@/db/schema";
import { hashToken } from "@/lib/crypto";
import {
  debugOwner,
  isDebugSameOrigin,
  issueDebugContext,
  verifyDebugContext,
} from "@/lib/observability/debug-context";
import { sessionUrl } from "@/lib/observability/tracing";
import { getSchoolBySlug } from "@/lib/schools/public";
import { requestBodyTooLarge } from "@/lib/security/limits";

export async function POST(request: Request) {
  if (requestBodyTooLarge(request.headers.get("content-length")))
    return Response.json({ error: "too_large" }, { status: 413 });
  if (!isDebugSameOrigin(request))
    return Response.json({ error: "forbidden" }, { status: 403 });
  const body = (await request.json()) as {
    slug?: string;
    resumeToken?: string;
  };
  if (
    !body.slug ||
    !body.resumeToken?.startsWith("dbg_") ||
    body.resumeToken.length > 128
  )
    return Response.json({ error: "invalid" }, { status: 400 });
  const school = await getSchoolBySlug(body.slug);
  const ownerId = school ? await debugOwner(school) : null;
  if (!school || !ownerId)
    return Response.json({ error: "forbidden" }, { status: 403 });
  const db = getDb();
  const [existing] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.schoolId, school.id),
        eq(conversations.resumeTokenHash, hashToken(body.resumeToken)),
      ),
    )
    .limit(1);
  if (existing) return Response.json({ error: "not_fresh" }, { status: 409 });
  return Response.json(
    { debugContext: issueDebugContext(school.id, ownerId, body.resumeToken) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug");
  const resumeToken = request.headers.get("x-debug-resume-token");
  const context = request.headers.get("x-debug-context");
  const school = slug ? await getSchoolBySlug(slug) : null;
  const ownerId = school ? await debugOwner(school) : null;
  if (
    !school ||
    !ownerId ||
    !resumeToken ||
    !context ||
    !verifyDebugContext(context, school.id, ownerId, resumeToken)
  ) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const [conversation] = await getDb()
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.schoolId, school.id),
        eq(conversations.resumeTokenHash, hashToken(resumeToken)),
      ),
    )
    .limit(1);
  return Response.json(
    { sessionUrl: conversation ? sessionUrl(conversation.id) : null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
