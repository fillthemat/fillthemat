import { isIP } from "node:net";
import { z } from "zod";

/** Host names only: URLs, ports, credentials and IP literals are not domains. */
export function normalizePoppyDomain(value: string): string | null {
  const domain = value
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
  if (
    domain.length > 253 ||
    isIP(domain) ||
    !domain.includes(".") ||
    !domain
      .split(".")
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
    /^\d+$/.test(domain.split(".").at(-1) ?? "")
  )
    return null;
  return domain;
}

export const poppyDomainSchema = z
  .string()
  .max(260)
  .transform(normalizePoppyDomain)
  .refine(
    (domain) => domain !== null,
    "Enter a domain like school.example, without https:// or a path.",
  );
