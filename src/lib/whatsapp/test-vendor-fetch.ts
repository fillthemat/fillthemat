/**
 * Playwright fakes server-to-server vendor HTTP, not connection commands or DB
 * writes. Explicit opt-in is limited to a local Supabase/app and never Vercel.
 * Works with `next start` in CI too; NODE_ENV alone cannot identify deployment.
 */
export function whatsAppTestVendorFetch(): typeof fetch | undefined {
  const origin = process.env.WHATSAPP_TEST_VENDOR_URL;
  if (!origin) return undefined;
  const loopback = (value: string | undefined) => {
    try {
      return ["127.0.0.1", "localhost"].includes(new URL(value ?? "").hostname);
    } catch {
      return false;
    }
  };
  if (
    process.env.VERCEL ||
    process.env.NEXT_PUBLIC_DEV_AUTH !== "true" ||
    !loopback(process.env.DATABASE_URL) ||
    !loopback(process.env.NEXT_PUBLIC_SUPABASE_URL) ||
    !loopback(process.env.NEXT_PUBLIC_SITE_URL) ||
    !loopback(origin) ||
    new URL(origin).protocol !== "http:"
  )
    throw new Error("whatsapp_test_vendor_requires_local_stack");
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (!["graph.facebook.com", "api.agentphone.ai"].includes(url.hostname))
      throw new Error("unexpected_whatsapp_test_vendor");
    return fetch(new URL(`${url.pathname}${url.search}`, origin), init);
  };
}
