"use client";

import { useState, useTransition } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { SettingsAction } from "./settings-form";
import { IDLE_STATE, type SettingsFormState } from "../form-state";

export function SectionStatus({
  state,
  pending,
  dirty,
  idleHint,
}: {
  state: SettingsFormState;
  pending: boolean;
  dirty: boolean;
  idleHint?: string;
}) {
  let message = idleHint ?? "";
  let tone = "text-muted-foreground";
  if (pending) {
    message = "Saving…";
    tone = "text-foreground";
  } else if (state.status === "error") {
    message = state.message ?? "That did not save.";
    tone = "text-destructive";
  } else if (dirty) {
    message = "Unsaved changes";
    tone = "text-warning";
  } else if (state.status === "success") {
    message = state.message ?? "Saved.";
    tone = "text-success";
  }
  return (
    <p
      role="status"
      aria-live="polite"
      aria-busy={pending || undefined}
      className={cn("min-w-0 flex-1 text-sm leading-relaxed text-pretty", tone)}
    >
      {message}
    </p>
  );
}

export function SaveBar({
  saveLabel,
  savingLabel = "Saving…",
  pending,
  dirty,
  onDiscard,
  onCancel,
  cancelLabel = "Cancel",
  state,
  idleHint,
}: {
  saveLabel: string;
  savingLabel?: string;
  pending: boolean;
  dirty: boolean;
  onDiscard?: () => void;
  onCancel?: () => void;
  cancelLabel?: string;
  state: SettingsFormState;
  idleHint?: string;
}) {
  return (
    <>
      <Separator />
      <div className="flex flex-col gap-3 sm:flex-row-reverse sm:items-center">
        <div className="flex shrink-0 gap-2">
          <Button type="submit" disabled={pending} aria-busy={pending || undefined}>
            {pending ? savingLabel : saveLabel}
          </Button>
          {onCancel ? (
            <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
              {cancelLabel}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={onDiscard}
              disabled={!dirty || pending}
            >
              Discard
            </Button>
          )}
        </div>
        <SectionStatus state={state} pending={pending} dirty={dirty} idleHint={idleHint} />
      </div>
    </>
  );
}

/** Item mutations keep their own result and destructive confirmation. */
export function ItemActionForm({
  action,
  id,
  label,
  pendingLabel,
  variant = "secondary",
  confirm,
  className,
  extraFields,
  disabled = false,
}: {
  action: SettingsAction;
  id: string;
  label: string;
  pendingLabel: string;
  variant?: "secondary" | "danger";
  confirm?: { title: string; body: React.ReactNode; confirmLabel: string };
  className?: string;
  extraFields?: Record<string, string>;
  disabled?: boolean;
}) {
  const [state, setState] = useState(IDLE_STATE);
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const submit = () =>
    startTransition(async () => {
      setState(await action({ id, ...extraFields }));
    });
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <Button
        type="button"
        variant={variant === "danger" ? "destructive" : "outline"}
        size="sm"
        disabled={pending || disabled}
        aria-busy={pending || undefined}
        onClick={confirm ? () => setOpen(true) : submit}
      >
        {pending ? pendingLabel : label}
      </Button>
      {state.status !== "idle" ? (
        <p
          role="status"
          aria-live="polite"
          className={cn(
            "text-xs leading-relaxed text-pretty",
            state.status === "error" ? "text-destructive" : "text-success",
          )}
        >
          {state.message}
        </p>
      ) : null}
      {confirm ? (
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{confirm.title}</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="text-sm text-pretty text-muted-foreground">{confirm.body}</div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => {
                  setOpen(false);
                  submit();
                }}
              >
                {confirm.confirmLabel}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  );
}
