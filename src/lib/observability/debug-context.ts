import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getVerifiedClaims } from "@/lib/auth/current-user";
import { hashToken } from "@/lib/crypto";

export function isDebugSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const configured = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "").origin;
    return origin === configured || origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function captureConfigured(): boolean {
  return (
    process.env.CHAT_DEBUG_CAPTURE_ENABLED === "1" &&
    Boolean(
      process.env.CHAT_DEBUG_CONTEXT_SECRET &&
        Buffer.byteLength(process.env.CHAT_DEBUG_CONTEXT_SECRET) >= 32 &&
        process.env.LANGFUSE_PUBLIC_KEY &&
        process.env.LANGFUSE_SECRET_KEY &&
        process.env.LANGFUSE_BASE_URL &&
        process.env.LANGFUSE_PROJECT_ID &&
        process.env.CHAT_DEBUG_OPERATOR_IDS,
    )
  );
}

export async function debugOwner(school: {
  id: string;
  ownerUserId: string;
}): Promise<string | null> {
  if (!captureConfigured()) return null;
  const claims = await getVerifiedClaims();
  if (!claims || claims.id !== school.ownerUserId) return null;
  const allowed =
    process.env.CHAT_DEBUG_OPERATOR_IDS?.split(",").map((id) => id.trim()) ??
    [];
  return allowed.includes(claims.id) ? claims.id : null;
}

type DebugBoundary = {
  schoolId: string;
  ownerId: string;
  tokenHash: string;
  expires: number;
};
function signature(payload: string): string {
  return createHmac(
    "sha256",
    process.env.CHAT_DEBUG_CONTEXT_SECRET ?? "disabled",
  )
    .update(payload)
    .digest("base64url");
}

export function issueDebugContext(
  schoolId: string,
  ownerId: string,
  resumeToken: string,
): string {
  if (!captureConfigured()) throw new Error("Debug capture is disabled");
  const payload = Buffer.from(
    JSON.stringify({
      schoolId,
      ownerId,
      tokenHash: hashToken(resumeToken),
      expires: Date.now() + 24 * 60 * 60 * 1000,
    } satisfies DebugBoundary),
  ).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function verifyDebugContext(
  context: string,
  schoolId: string,
  ownerId: string,
  resumeToken: string,
): boolean {
  if (!captureConfigured() || context.length > 2048) return false;
  const [payload, mac, extra] = context.split(".");
  if (!payload || !mac || extra) return false;
  const expected = Buffer.from(signature(payload));
  const actual = Buffer.from(mac);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return false;
  try {
    const data = JSON.parse(
      Buffer.from(payload, "base64url").toString(),
    ) as DebugBoundary;
    return (
      data.schoolId === schoolId &&
      data.ownerId === ownerId &&
      data.tokenHash === hashToken(resumeToken) &&
      Number.isFinite(data.expires) &&
      data.expires > Date.now()
    );
  } catch {
    return false;
  }
}
