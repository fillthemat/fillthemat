import { maskContactFields } from "../../src/lib/tracing/span-processor";

/** Eval exports may contain JSON-encoded trace inputs inside other fields. */
export function maskEvalFields(value: unknown): unknown {
  if (typeof value === "string") {
    const start = value.trimStart()[0];
    if (start === "{" || start === "[") {
      try {
        return JSON.stringify(maskEvalFields(JSON.parse(value)));
      } catch {
        // Ordinary text, not encoded JSON.
      }
    }
  }
  if (Array.isArray(value)) return value.map(maskEvalFields);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        maskContactFields(key),
        maskEvalFields(item),
      ]),
    );
  }
  return maskContactFields(value);
}
