import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { poppyClients, poppySessions, poppySessionTokens } from "@/db/schema";
import { requireUnblockedPoppyClient } from "./admission";
import { poppyTokenHash, verifyPoppyDpop } from "./dpop";
import { PoppyError, poppyErrorResponse } from "./errors";
import { isSchoolPoppyOn } from "./issuer";
import { isPoppyOrigin, poppyAppOrigin, schoolIssuer } from "./urls";

/** Internal authorization context; never serialize the opaque User ID to traces. */
export type PoppyPrincipal = {
  schoolId: string;
  sessionId: string;
  clientId: string;
  userId: string;
  displayName: string;
  extensions: Record<string, unknown>;
};
export type PoppyAuthorization =
  | { ok: true; principal: PoppyPrincipal }
  | { ok: false; response: Response };

/** All Poppy app-host resource handlers call this before doing any business work. */
export async function checkPoppyRequest(
  request: Request,
  schoolId: string,
): Promise<PoppyAuthorization> {
  try {
    const pathname = new URL(request.url).pathname;
    if (
      !isPoppyOrigin(request, "app") ||
      !pathname.startsWith(`/poppy/schools/${schoolId}/`) ||
      !(await isSchoolPoppyOn(schoolId))
    )
      throw new PoppyError("not_found", 404);
    const authorization = request.headers.get("authorization");
    const token = /^DPoP ([A-Za-z0-9_-]{43})$/i.exec(authorization ?? "")?.[1];
    if (!token) throw new PoppyError("invalid_token", 401);
    const [row] = await getDb()
      .select({
        sessionId: poppySessions.id,
        userId: poppySessions.userId,
        clientId: poppySessions.clientId,
        displayName: poppyClients.displayName,
        extensions: poppyClients.extensions,
        thumbprint: poppySessionTokens.dpopThumbprint,
      })
      .from(poppySessionTokens)
      .innerJoin(
        poppySessions,
        and(
          eq(poppySessions.id, poppySessionTokens.sessionId),
          eq(poppySessions.schoolId, poppySessionTokens.schoolId),
        ),
      )
      .innerJoin(
        poppyClients,
        eq(poppyClients.clientId, poppySessions.clientId),
      )
      .where(
        and(
          eq(poppySessionTokens.tokenHash, poppyTokenHash(token)),
          eq(poppySessionTokens.schoolId, schoolId),
          gt(poppySessionTokens.expiresAt, new Date()),
          isNull(poppySessions.endedAt),
        ),
      );
    if (!row) throw new PoppyError("invalid_token", 401);
    await requireUnblockedPoppyClient(row.clientId);
    await verifyPoppyDpop(
      request,
      `${poppyAppOrigin()}${pathname}`,
      schoolIssuer(schoolId),
      { token, thumbprint: row.thumbprint },
    );
    return {
      ok: true,
      principal: {
        schoolId,
        sessionId: row.sessionId,
        clientId: row.clientId,
        userId: row.userId,
        displayName: row.displayName,
        extensions: row.extensions,
      },
    };
  } catch (error) {
    return { ok: false, response: poppyErrorResponse(error, true) };
  }
}
