import { and, eq, isNull, lte, or } from "drizzle-orm";
import {
  createLocalJWKSet,
  decodeProtectedHeader,
  type JWK,
  type JWTPayload,
  jwtVerify,
} from "jose";
import { z } from "zod";
import { getDb } from "@/db";
import { type PoppyClient, poppyClients } from "@/db/schema";
import { PoppyError } from "./errors";
import { safeFetch } from "./safe-fetch";

const metadataSchema = z.object({
  client_id: z.string(),
  client_name: z.string().min(1).max(200),
  jwks_uri: z.string(),
  token_endpoint_auth_method: z.literal("private_key_jwt"),
  redirect_uris: z.array(z.string()).max(20).optional(),
  extensions: z.record(z.string(), z.unknown()).default({}),
});
const jwksSchema = z.object({
  keys: z.array(z.record(z.string(), z.unknown())).min(1).max(20),
});

function httpsUrl(value: string): URL {
  const url = new URL(value);
  if (
    value.length > 2048 ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== "443")
  )
    throw new PoppyError("invalid_client", 401);
  return url;
}

async function fetchClient(clientId: string) {
  const url = httpsUrl(clientId);
  const metadataReply = await safeFetch(clientId);
  if (metadataReply.status !== 200) throw new PoppyError("invalid_client", 401);
  const metadata = metadataSchema.parse(
    JSON.parse(metadataReply.body.toString("utf8")),
  );
  if (
    metadata.client_id !== clientId ||
    httpsUrl(metadata.jwks_uri).hostname !== url.hostname ||
    metadata.redirect_uris?.some(
      (uri) => httpsUrl(uri).hostname !== url.hostname,
    )
  )
    throw new PoppyError("invalid_client", 401);
  const keysReply = await safeFetch(metadata.jwks_uri);
  if (keysReply.status !== 200) throw new PoppyError("invalid_client", 401);
  const jwks = jwksSchema.parse(JSON.parse(keysReply.body.toString("utf8")));
  for (const key of jwks.keys) {
    if (
      ["d", "p", "q", "dp", "dq", "qi", "oth", "k"].some((name) => name in key)
    )
      throw new PoppyError("invalid_client", 401);
    if (key.kty === "RSA") {
      if (
        typeof key.n !== "string" ||
        Buffer.from(key.n, "base64url").length < 256 ||
        (key.alg !== undefined && key.alg !== "RS256")
      )
        throw new PoppyError("invalid_client", 401);
    } else if (
      key.kty !== "EC" ||
      key.crv !== "P-256" ||
      (key.alg !== undefined && key.alg !== "ES256")
    )
      throw new PoppyError("invalid_client", 401);
  }
  // Honor shorter cache lifetimes, but never trust a peer to pin keys indefinitely.
  const ttl = Math.min(
    ...[metadataReply, keysReply].map((reply) => {
      const cache = reply.headers.get("cache-control") ?? "";
      if (/no-store|no-cache/i.test(cache)) return 0;
      const age = /(?:^|,)\s*max-age=(\d+)/i.exec(cache)?.[1];
      return age ? Math.min(Number(age), 3600) : 300;
    }),
  );
  return {
    displayName: metadata.client_name,
    extensions: metadata.extensions,
    jwks: jwks as { keys: JWK[] },
    cachedUntil: new Date(Date.now() + ttl * 1000),
    refreshAfter: new Date(Date.now() + 60000),
  };
}

/** Cache and unknown-kid refresh coordination live in Postgres, not process memory. */
export async function registeredPoppyClient(
  clientId: string,
  kid?: string,
): Promise<PoppyClient> {
  const db = getDb();
  let [client] = await db
    .select()
    .from(poppyClients)
    .where(eq(poppyClients.clientId, clientId));
  const now = new Date();
  const unknownKid = Boolean(
    kid && client && !client.jwks.keys.some((key) => key.kid === kid),
  );
  if (
    client &&
    client.cachedUntil > now &&
    (!kid || client.jwks.keys.some((key) => key.kid === kid))
  )
    return client;
  const leaseUntil = new Date(now.getTime() + 25000);
  if (client) {
    const [lease] = await db
      .update(poppyClients)
      .set({
        refreshingUntil: leaseUntil,
        ...(unknownKid
          ? { refreshAfter: new Date(now.getTime() + 60000) }
          : {}),
      })
      .where(
        and(
          eq(poppyClients.clientId, clientId),
          or(
            isNull(poppyClients.refreshingUntil),
            lte(poppyClients.refreshingUntil, now),
          ),
          unknownKid ? lte(poppyClients.refreshAfter, now) : undefined,
        ),
      )
      .returning();
    if (!lease) throw new PoppyError("invalid_client", 401);
  }
  let fetched: Awaited<ReturnType<typeof fetchClient>>;
  try {
    fetched = await fetchClient(clientId);
  } catch {
    throw new PoppyError("invalid_client", 401);
  }
  if (client) {
    [client] = await db
      .update(poppyClients)
      .set({ ...fetched, refreshingUntil: null })
      .where(
        and(
          eq(poppyClients.clientId, clientId),
          eq(poppyClients.refreshingUntil, leaseUntil),
        ),
      )
      .returning();
    if (!client) throw new PoppyError("invalid_client", 401);
  } else {
    [client] = await db
      .insert(poppyClients)
      .values({ clientId, ...fetched })
      .onConflictDoNothing()
      .returning();
    if (!client)
      [client] = await db
        .select()
        .from(poppyClients)
        .where(eq(poppyClients.clientId, clientId));
  }
  if (!client) throw new Error("failed to persist Poppy client");
  return client;
}

/** Both assertion kinds use a single exact token-endpoint audience, a <=120s
 * lifetime, mandatory iat/jti, and 5s clock tolerance. Session sub is the User;
 * private_key_jwt sub is checked separately against the HTTPS client identity. */
export async function verifyClientJwt(
  jwt: string,
  client: PoppyClient,
  endpoint: string,
): Promise<JWTPayload> {
  const { payload } = await jwtVerify(jwt, createLocalJWKSet(client.jwks), {
    algorithms: ["ES256", "RS256"],
    issuer: client.clientId,
    audience: endpoint,
    clockTolerance: 5,
    requiredClaims: ["iss", "sub", "aud", "iat", "exp", "jti"],
  });
  if (
    payload.aud !== endpoint ||
    typeof payload.sub !== "string" ||
    !payload.sub ||
    payload.sub.length > 2048 ||
    typeof payload.jti !== "string" ||
    !payload.jti ||
    payload.jti.length > 256 ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number" ||
    !Number.isInteger(payload.iat) ||
    !Number.isInteger(payload.exp) ||
    payload.exp <= payload.iat ||
    payload.exp - payload.iat > 120 ||
    payload.iat > Math.floor(Date.now() / 1000) + 5 ||
    payload.iat < Math.floor(Date.now() / 1000) - 125
  )
    throw new Error("invalid assertion claims");
  return payload;
}

export function assertionKid(jwt: string): string | undefined {
  const header = decodeProtectedHeader(jwt);
  if (
    header.kid !== undefined &&
    (typeof header.kid !== "string" || header.kid.length > 256)
  )
    throw new PoppyError("invalid_client", 401);
  return header.kid;
}
