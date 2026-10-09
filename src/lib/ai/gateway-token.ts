/** The environment variables that can hold an AI Gateway token. */
export const GATEWAY_TOKEN_ENV_VARS = [
  "VERCEL_OIDC_TOKEN",
  "AI_GATEWAY_API_KEY",
] as const;

/** Whether `env` has a non-empty AI Gateway token. */
export function hasGatewayToken(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return GATEWAY_TOKEN_ENV_VARS.some((name) => Boolean(env[name]));
}
