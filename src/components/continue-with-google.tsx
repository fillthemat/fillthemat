"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";

export function ContinueWithGoogle({
  next = "/dashboard",
  linkAccount = false,
}: {
  next?: string;
  linkAccount?: boolean;
}) {
  const [message, setMessage] = useState("");
  async function onClick() {
    const supabase = createClient();
    const redirectTo = new URL("/auth/callback", window.location.origin);
    redirectTo.searchParams.set("next", next);
    const request = {
      provider: "google" as const,
      options: {
        redirectTo: redirectTo.toString(),
        scopes: "openid email profile",
      },
    };
    const { error } = linkAccount
      ? await supabase.auth.linkIdentity(request)
      : await supabase.auth.signInWithOAuth(request);
    if (error) setMessage(error.message);
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        className="inline-flex h-11 items-center justify-center rounded-full bg-foreground px-5 text-sm font-medium text-background"
      >
        {linkAccount ? "Link Google account" : "Continue with Google"}
      </button>
      {message && <p role="alert">{message}</p>}
    </>
  );
}
