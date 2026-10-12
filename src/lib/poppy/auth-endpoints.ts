import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { poppySessions, poppySessionTokens } from "@/db/schema";
import {
  assertionKid,
  registeredPoppyClient,
  verifyClientJwt,
} from "./client-registry";
import { poppyTokenHash, verifyPoppyDpop } from "./dpop";
import { PoppyError, poppyErrorResponse } from "./errors";
import { isSchoolPoppyOn } from "./issuer";
import { acceptPoppyReplay } from "./replay";
import { isPoppyOrigin, schoolIssuer } from "./urls";

async function formRequest(request: Request): Promise<URLSearchParams> {
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim() !==
    "application/x-www-form-urlencoded"
  )
    throw new PoppyError("invalid_request");
  if (!request.body) throw new PoppyError("invalid_request");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 32768) {
        await reader.cancel();
        throw new PoppyError("invalid_request");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
  for (const key of new Set(form.keys()))
    if (form.getAll(key).length !== 1) throw new PoppyError("invalid_request");
  return form;
}

async function authenticateClient(
  form: URLSearchParams,
  endpoint: string,
  issuer: string,
) {
  const clientId = form.get("client_id");
  const assertion = form.get("client_assertion");
  if (
    !clientId ||
    !assertion ||
    form.get("client_assertion_type") !==
      "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"
  )
    throw new PoppyError("invalid_client", 401);
  let kid: string | undefined;
  try {
    kid = assertionKid(assertion);
  } catch {
    throw new PoppyError("invalid_client", 401);
  }
  const client = await registeredPoppyClient(clientId, kid);
  let claims: Awaited<ReturnType<typeof verifyClientJwt>>;
  try {
    claims = await verifyClientJwt(assertion, client, endpoint);
    if (claims.sub !== clientId) throw new Error("client subject mismatch");
  } catch {
    throw new PoppyError("invalid_client", 401);
  }
  if (
    !(await acceptPoppyReplay(
      "client",
      issuer,
      clientId,
      String(claims.jti),
      new Date((Number(claims.exp) + 6) * 1000),
    ))
  )
    throw new PoppyError("invalid_client", 401);
  return client;
}

export async function handlePoppyToken(
  request: Request,
  schoolId: string,
): Promise<Response> {
  try {
    if (!isPoppyOrigin(request, "auth") || !(await isSchoolPoppyOn(schoolId)))
      throw new PoppyError("invalid_client", 401);
    const issuer = schoolIssuer(schoolId);
    const endpoint = `${issuer}/token`;
    const form = await formRequest(request);
    if (
      form.get("grant_type") !== "urn:ietf:params:oauth:grant-type:jwt-bearer"
    )
      throw new PoppyError("unsupported_grant_type");
    const client = await authenticateClient(form, endpoint, issuer);
    const assertion = form.get("assertion") ?? "";
    let sessionKid: string | undefined;
    try {
      sessionKid = assertionKid(assertion);
    } catch {
      throw new PoppyError("invalid_grant");
    }
    let sessionClient = client;
    if (sessionKid && !client.jwks.keys.some((key) => key.kid === sessionKid)) {
      try {
        sessionClient = await registeredPoppyClient(
          client.clientId,
          sessionKid,
        );
      } catch (error) {
        if (error instanceof PoppyError) throw new PoppyError("invalid_grant");
        throw error;
      }
    }
    let claims: Awaited<ReturnType<typeof verifyClientJwt>>;
    try {
      claims = await verifyClientJwt(assertion, sessionClient, endpoint);
      if (String(claims.sub).length > 256) throw new Error("User ID too long");
    } catch {
      throw new PoppyError("invalid_grant");
    }
    if (
      !(await acceptPoppyReplay(
        "session",
        issuer,
        client.clientId,
        String(claims.jti),
        new Date((Number(claims.exp) + 6) * 1000),
      ))
    )
      throw new PoppyError("invalid_grant");
    const thumbprint = await verifyPoppyDpop(request, endpoint, issuer);
    const sessionId = form.get("session_id");
    if (sessionId !== null && !z.uuid().safeParse(sessionId).success)
      throw new PoppyError("invalid_session");
    const accessToken = randomBytes(32).toString("base64url");
    const db = getDb();
    const session = await db.transaction(async (tx) => {
      const [existing] = sessionId
        ? await tx
            .select()
            .from(poppySessions)
            .where(
              and(
                eq(poppySessions.id, sessionId),
                eq(poppySessions.schoolId, schoolId),
                eq(poppySessions.clientId, client.clientId),
                eq(poppySessions.userId, String(claims.sub)),
                isNull(poppySessions.endedAt),
              ),
            )
            .for("update")
        : [];
      if (sessionId && (!existing || existing.dpopThumbprint !== thumbprint))
        throw new PoppyError("invalid_session");
      const [created] = existing
        ? []
        : await tx
            .insert(poppySessions)
            .values({
              schoolId,
              clientId: client.clientId,
              userId: String(claims.sub),
              dpopThumbprint: thumbprint,
            })
            .returning();
      const current = existing ?? created;
      if (!current) throw new Error("failed to create Poppy Session");
      await tx.insert(poppySessionTokens).values({
        tokenHash: poppyTokenHash(accessToken),
        schoolId,
        sessionId: current.id,
        dpopThumbprint: thumbprint,
        expiresAt: new Date(Date.now() + 600000),
      });
      return current;
    });
    return Response.json(
      {
        access_token: accessToken,
        token_type: "DPoP",
        expires_in: 600,
        scope: "",
        session_id: session.id,
        signed_in: false,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return poppyErrorResponse(error);
  }
}

export async function handlePoppyRevocation(
  request: Request,
  schoolId: string,
): Promise<Response> {
  try {
    if (!isPoppyOrigin(request, "auth") || !(await isSchoolPoppyOn(schoolId)))
      throw new PoppyError("invalid_client", 401);
    const issuer = schoolIssuer(schoolId);
    // Same private_key_jwt audience as token authentication (RFC 7523 profile).
    await authenticateClient(
      await formRequest(request),
      `${issuer}/token`,
      issuer,
    );
    // RFC 7009 success, including unknown tokens; no Account Tokens exist.
    return new Response(null, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return poppyErrorResponse(error);
  }
}
