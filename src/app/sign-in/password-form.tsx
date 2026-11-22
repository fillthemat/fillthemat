"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/browser";

export function PasswordForm({ signup }: { signup: boolean }) {
  const [message, action, pending] = useActionState(async (_previous: string, fields: FormData) => {
    const credentials = {
      email: String(fields.get("email")).trim(),
      password: String(fields.get("password")),
    };
    try {
      const { auth } = createClient();
      const { data, error } = signup
        ? await auth.signUp({
            ...credentials,
            options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
          })
        : await auth.signInWithPassword(credentials);
      if (error) return error.message;
      if (!data.session) return "Check your email for a confirmation link, then sign in.";
      window.location.replace("/dashboard");
      return "";
    } catch {
      return "Could not reach the sign-in service. Please try again.";
    }
  }, "");
  return (
    <form action={action} className="flex flex-col gap-3">
      <Label htmlFor="email">Email</Label>
      <Input id="email" name="email" type="email" autoComplete="email" required />
      <Label htmlFor="password">Password</Label>
      <Input
        id="password"
        name="password"
        type="password"
        autoComplete={signup ? "new-password" : "current-password"}
        minLength={signup ? 8 : undefined}
        required
      />
      <Button type="submit" disabled={pending}>
        {signup ? "Create account" : "Sign in"}
      </Button>
      <p role="status">{message}</p>
      <Link href={signup ? "/sign-in" : "/sign-in?mode=signup"} className="text-sm underline">
        {signup ? "Already have an account? Sign in" : "New here? Create an account"}
      </Link>
    </form>
  );
}
