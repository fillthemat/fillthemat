import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function safeNext(value: string | null): string {
  if (value == null) return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const cookieNext = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("fillthemat_next="))
    ?.slice("fillthemat_next=".length);
  const next = safeNext(
    url.searchParams.get("next") ?? (cookieNext ? decodeURIComponent(cookieNext) : null),
  );

  if (!code) {
    return NextResponse.redirect(new URL("/auth/error", url.origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL("/auth/error", url.origin));
  }
  const response = NextResponse.redirect(new URL(next, url.origin));
  response.cookies.delete("fillthemat_next");
  return response;
}
