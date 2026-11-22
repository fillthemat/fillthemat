"use client";

import { useActionState } from "react";
import { setPassword } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SetPassword() {
  const [message, action, pending] = useActionState(setPassword, "");
  return (
    <form action={action} className="flex flex-col gap-3">
      <h2 className="font-semibold">Set a password</h2>
      <Label htmlFor="new-password">New password</Label>
      <Input
        id="new-password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
      />
      <Label htmlFor="confirm-password">Confirm password</Label>
      <Input
        id="confirm-password"
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
      />
      <Button type="submit" disabled={pending}>
        Save password
      </Button>
      <p role="status">{message}</p>
    </form>
  );
}
