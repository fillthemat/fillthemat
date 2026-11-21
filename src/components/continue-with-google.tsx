"use client";

import { createClient } from "@/lib/supabase/browser";

export function ContinueWithGoogle({ next = "/dashboard" }: { next?: string }) {
  async function onClick() {
    const supabase = createClient();
    const redirectTo = new URL("/auth/callback", window.location.origin);
    redirectTo.searchParams.set("next", next);
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: redirectTo.toString(),
        scopes: "openid email profile",
      },
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-11 items-center justify-center rounded-full bg-foreground px-5 text-sm font-medium text-background"
    >
      Continue with Google
    </button>
  );
}
