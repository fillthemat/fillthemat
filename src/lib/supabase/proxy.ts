import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

export async function updateSession(request: NextRequest) {
  // Platform endpoints authenticate with their cron secret/provider signature,
  // not an owner's browser session. Keep this list exact, not all /api routes.
  if (
    request.nextUrl.pathname === "/api/cron/maintenance" ||
    request.nextUrl.pathname === "/api/webhooks/resend"
  ) {
    return NextResponse.next({ request });
  }
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));

          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );

          Object.entries(headers).forEach(([key, value]) =>
            supabaseResponse.headers.set(key, value),
          );
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  const pathname = request.nextUrl.pathname;
  const publicLandingPath = pathname.startsWith("/s/") || pathname === "/api/sessions";
  if (!user && !pathname.startsWith("/sign-in") && !publicLandingPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
