import { createHash, randomBytes, randomUUID } from "node:crypto";
import { exportJWK, generateKeyPair, type JWTPayload, SignJWT } from "jose";
import { schoolIssuer } from "@/lib/poppy/urls";

/** A real signing Personal Agent; only its outbound HTTPS peer is stubbed. */
export async function createTestPoppyAgent(
  options: {
    alg?: "ES256" | "RS256";
    dpopAlg?: "ES256" | "RS256";
    clientId?: string;
  } = {},
) {
  const alg = options.alg ?? "ES256";
  let clientKeys = await generateKeyPair(alg, { extractable: true });
  const dpopAlg = options.dpopAlg ?? "ES256";
  const proofKeys = await generateKeyPair(dpopAlg, { extractable: true });
  const clientId =
    options.clientId ?? `https://agent-${randomUUID()}.example/client.json`;
  let kid = randomUUID();
  const userIds = new Map<string, string>();
  function userIdForSchool(schoolId: string): string {
    const issuer = schoolIssuer(schoolId);
    const id = userIds.get(issuer) ?? randomBytes(24).toString("base64url");
    userIds.set(issuer, id);
    return id;
  }
  const jwks = {
    keys: [
      { ...(await exportJWK(clientKeys.publicKey)), kid, alg, use: "sig" },
    ],
  };
  const proofJwk = await exportJWK(proofKeys.publicKey);
  const metadata = {
    client_id: clientId,
    client_name: "Test Personal Agent",
    jwks_uri: new URL("/jwks.json", clientId).href,
    token_endpoint_auth_method: "private_key_jwt",
    extensions: { operations: { version: "1" } },
  };
  const claims = (overrides: JWTPayload = {}) => ({
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60,
    jti: randomBytes(24).toString("base64url"),
    ...overrides,
  });
  const signAssertion = (payload: JWTPayload) =>
    new SignJWT(payload)
      .setProtectedHeader({ alg, kid })
      .sign(clientKeys.privateKey);
  async function sessionAssertion(
    schoolId: string,
    overrides: JWTPayload = {},
  ) {
    return signAssertion(
      claims({
        iss: clientId,
        sub: userIdForSchool(schoolId),
        aud: `${schoolIssuer(schoolId)}/token`,
        ...overrides,
      }),
    );
  }
  async function clientAssertion(endpoint: string, overrides: JWTPayload = {}) {
    return signAssertion(
      claims({ iss: clientId, sub: clientId, aud: endpoint, ...overrides }),
    );
  }
  async function dpopProof(
    url: string,
    method = "POST",
    token?: string,
    overrides: JWTPayload = {},
  ) {
    const target = new URL(url);
    target.search = "";
    target.hash = "";
    return new SignJWT({
      jti: randomBytes(24).toString("base64url"),
      iat: Math.floor(Date.now() / 1000),
      htm: method,
      htu: target.href,
      ...(token
        ? { ath: createHash("sha256").update(token).digest("base64url") }
        : {}),
      ...overrides,
    })
      .setProtectedHeader({ alg: dpopAlg, typ: "dpop+jwt", jwk: proofJwk })
      .sign(proofKeys.privateKey);
  }
  async function tokenRequest(
    schoolId: string,
    options: {
      sessionId?: string;
      assertion?: string;
      clientAssertion?: string;
      proof?: string;
      sessionClaims?: JWTPayload;
      clientClaims?: JWTPayload;
      proofClaims?: JWTPayload;
    } = {},
  ) {
    const endpoint = `${schoolIssuer(schoolId)}/token`;
    return new Request(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        DPoP:
          options.proof ??
          (await dpopProof(endpoint, "POST", undefined, options.proofClaims)),
      },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion:
          options.assertion ??
          (await sessionAssertion(schoolId, options.sessionClaims)),
        client_id: clientId,
        client_assertion_type:
          "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        client_assertion:
          options.clientAssertion ??
          (await clientAssertion(endpoint, options.clientClaims)),
        ...(options.sessionId ? { session_id: options.sessionId } : {}),
      }),
    });
  }
  async function protectedRequest(
    url: string,
    token: string,
    options: {
      method?: string;
      proof?: string;
      proofClaims?: JWTPayload;
      body?: unknown;
    } = {},
  ) {
    const method = options.method ?? "GET";
    return new Request(url, {
      method,
      headers: {
        Authorization: `DPoP ${token}`,
        DPoP:
          options.proof ??
          (await dpopProof(url, method, token, options.proofClaims)),
        "content-type": "application/json",
      },
      ...(options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {}),
    });
  }
  const fetchReply = async (url: URL) => ({
    status: url.href === clientId || url.href === metadata.jwks_uri ? 200 : 404,
    headers: new Headers({
      "content-type": "application/json",
      "cache-control": "max-age=300",
    }),
    body: Buffer.from(JSON.stringify(url.href === clientId ? metadata : jwks)),
  });
  async function rotateClientKeys() {
    clientKeys = await generateKeyPair(alg, { extractable: true });
    kid = randomUUID();
    jwks.keys = [
      { ...(await exportJWK(clientKeys.publicKey)), kid, alg, use: "sig" },
    ];
  }
  return {
    clientId,
    userIdForSchool,
    get kid() {
      return kid;
    },
    metadata,
    jwks,
    rotateClientKeys,
    sessionAssertion,
    clientAssertion,
    dpopProof,
    tokenRequest,
    protectedRequest,
    fetchReply,
  };
}
