function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, "");
}

function configuredSiteUrl(): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (!site) {
    throw new Error("NEXT_PUBLIC_SITE_URL is not set");
  }
  return stripTrailingSlash(site);
}

export function getSiteUrl(headers?: Headers): string {
  if (process.env.VERCEL_ENV === "preview" && headers) {
    const host = headers.get("x-forwarded-host");
    const proto = headers.get("x-forwarded-proto") === "http" ? "http" : "https";
    if (host && /^[a-z0-9.-]+$/i.test(host)) {
      return `${proto}://${host}`;
    }
  }
  return configuredSiteUrl();
}

export function publicSchoolPath(slug: string): string {
  return `/s/${slug}`;
}

export function publicSchoolUrl(slug: string, headers?: Headers): string {
  return `${getSiteUrl(headers)}${publicSchoolPath(slug)}`;
}
