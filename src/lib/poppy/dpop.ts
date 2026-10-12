import { createHash } from "node:crypto";
import {
  calculateJwkThumbprint,
  decodeProtectedHeader,
  importJWK,
  jwtVerify,
} from "jose";
import { PoppyError } from "./errors";
import { acceptPoppyReplay } from "./replay";

export function poppyTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function verifyPoppyDpop(
  request: Request,
  endpoint: string,
  issuer: string,
  binding?: { token: string; thumbprint: string },
): Promise<string> {
  let thumbprint: string;
  let jti: string;
  let expiresAt: Date;
  try {
    const proof = request.headers.get("dpop");
    if (!proof || proof.length > 8192) throw new Error("missing proof");
    const header = decodeProtectedHeader(proof);
    const key = header.jwk;
    if (
      header.typ !== "dpop+jwt" ||
      !key ||
      ["d", "p", "q", "dp", "dq", "qi", "oth", "k"].some(
        (name) => name in key,
      ) ||
      !(
        (header.alg === "ES256" && key.kty === "EC" && key.crv === "P-256") ||
        (header.alg === "RS256" && key.kty === "RSA")
      )
    )
      throw new Error("invalid proof key");
    const { payload } = await jwtVerify(
      proof,
      await importJWK(key, header.alg),
      { algorithms: ["ES256", "RS256"] },
    );
    const now = Math.floor(Date.now() / 1000);
    if (
      typeof payload.iat !== "number" ||
      !Number.isInteger(payload.iat) ||
      payload.iat < now - 60 ||
      payload.iat > now + 5 ||
      typeof payload.jti !== "string" ||
      !payload.jti ||
      payload.jti.length > 256 ||
      payload.htm !== request.method ||
      payload.htu !== endpoint
    )
      throw new Error("invalid proof claims");
    thumbprint = await calculateJwkThumbprint(key);
    if (
      binding &&
      (binding.thumbprint !== thumbprint ||
        payload.ath !==
          createHash("sha256").update(binding.token).digest("base64url"))
    )
      throw new Error("invalid token binding");
    jti = payload.jti;
    expiresAt = new Date((payload.iat + 66) * 1000);
  } catch {
    throw new PoppyError("invalid_dpop_proof", binding ? 401 : 400);
  }
  // Storage exceptions deliberately escape validation: fail closed, visibly.
  if (!(await acceptPoppyReplay("dpop", issuer, thumbprint, jti, expiresAt)))
    throw new PoppyError("invalid_dpop_proof", binding ? 401 : 400);
  return thumbprint;
}
