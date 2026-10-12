function configuredOrigin(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is not configured`);
  const url = new URL(value);
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      `${name} must be an HTTPS origin (HTTP loopback is allowed locally)`,
    );
  }
  return url.origin;
}

export function poppyAppOrigin(): string {
  return configuredOrigin(
    process.env.NEXT_PUBLIC_SITE_URL,
    "NEXT_PUBLIC_SITE_URL",
  );
}

export function poppyAuthOrigin(): string {
  const app = poppyAppOrigin();
  const local = ["127.0.0.1", "localhost"].includes(new URL(app).hostname);
  return configuredOrigin(
    process.env.POPPY_AUTH_ORIGIN || (local ? app : undefined),
    "POPPY_AUTH_ORIGIN",
  );
}

export function schoolIssuer(schoolId: string): string {
  return `${poppyAuthOrigin()}/schools/${schoolId}`;
}

export function schoolDiscoveryUrl(schoolId: string, domain: string): string {
  return `${poppyAppOrigin()}/poppy/discovery/${schoolId}/${domain}`;
}

export function isPoppyOrigin(request: Request, kind: "app" | "auth"): boolean {
  const configured = new URL(
    kind === "app" ? poppyAppOrigin() : poppyAuthOrigin(),
  );
  // Host selects a virtual host only; it never supplies an issuer or endpoint URL.
  // Next may build request.url using its internal listen address behind a proxy.
  const host = request.headers.get("host") ?? new URL(request.url).host;
  return host.toLowerCase() === configured.host;
}
