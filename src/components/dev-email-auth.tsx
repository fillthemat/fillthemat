"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/browser";

export function DevEmailAuth() {
  const id = useId();
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
      <FieldGroup className="gap-3">
        <Field className="gap-1">
          <FieldLabel htmlFor={`${id}-email`}>Email</FieldLabel>
          <Input
            id={`${id}-email`}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="username"
          />
        </Field>
        <Field className="gap-1">
          <FieldLabel htmlFor={`${id}-password`}>Password</FieldLabel>
          <Input
            id={`${id}-password`}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </Field>
      </FieldGroup>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex gap-2">
        <Button
          type="submit"
          size="lg"
          disabled={pending}
          onClick={(e) => void handleLogin(e, "signin")}
          className="flex-1"
        >
          Sign in
        </Button>
        <Button
          type="button"
          variant="outline"
          size="lg"
          disabled={pending}
          onClick={(e) => void handleLogin(e, "signup")}
        >
          Sign up
        </Button>
      </div>
      <p className="text-xs text-page-500">
        Seeded owner: owner@local.test / local-dev-password. Not shown in production builds.
      </p>
    </form>
  );
}
