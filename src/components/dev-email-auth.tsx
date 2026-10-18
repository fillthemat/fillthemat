"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";

export function DevEmailAuth() {
  const [email, setEmail] = useState("owner@local.test");
  const [password, setPassword] = useState("local-dev-password");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  type LOGIN_MODE = "signin" | "signup";
  const handleLogin = async (e: React.MouseEvent, mode: LOGIN_MODE) => {
    e.preventDefault();

    const supabase = createClient();
    setPending(true);
    setError(null);
    try {
      const { error } =
        mode === "signin"
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({ email, password });
      if (error) throw error;

      router.replace("/dashboard");
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "An error occurred");
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="flex flex-col gap-3 rounded-xl border border-dashed border-page-700 p-4">
      <p className="text-xs tracking-wide text-page-500 uppercase">Local email auth</p>
      <label className="flex flex-col gap-1 text-sm">
        Email
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="username"
          className="rounded-md border border-page-700 bg-transparent px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Password
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          className="rounded-md border border-page-700 bg-transparent px-3 py-2"
        />
      </label>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          onClick={(e) => void handleLogin(e, "signin")}
          className="inline-flex h-11 flex-1 items-center justify-center rounded-full bg-foreground px-5 text-sm font-medium text-background disabled:opacity-60"
        >
          Sign in
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={(e) => void handleLogin(e, "signup")}
          className="inline-flex h-11 items-center justify-center rounded-full border border-page-600 px-5 text-sm disabled:opacity-60"
        >
          Sign up
        </button>
      </div>
      <p className="text-xs text-page-500">
        Seeded owner: owner@local.test / local-dev-password. Not shown in production builds.
      </p>
    </form>
  );
}
