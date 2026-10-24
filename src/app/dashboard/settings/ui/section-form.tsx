"use client";

import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { cn } from "@/lib/utils";
import { IDLE_STATE, type SettingsFormState } from "../form-state";
import { applyCreateSuccessValues, applySavedValues, sameValues } from "../form-utils";
import { useDirtyRegistration } from "./dirty-context";

export type SettingsAction = (
  state: SettingsFormState,
  formData: FormData,
) => Promise<SettingsFormState>;

type Values = Record<string, string>;

export type SaveSuccessMeta = {
  preservedEdits: boolean;
};

/**
 * Controlled form state for one settings section:
 * unsaved tracking, pending/success/error, and inline field errors.
 */
export function useSettingsForm<T extends Values>({
  action,
  initialValues,
  dirtyKey,
  clearOnSuccess = false,
  onSuccess,
  onPendingChange,
}: {
  action: SettingsAction;
  initialValues: T;
  dirtyKey: string;
  clearOnSuccess?: boolean;
  onSuccess?: (state: SettingsFormState, meta: SaveSuccessMeta) => void;
  onPendingChange?: (pending: boolean) => void;
}) {
  const [state, dispatch, pending] = useActionState(action, IDLE_STATE);
  const [values, setValues] = useState<T>(initialValues);
  const [baseline, setBaseline] = useState<T>(initialValues);
  const [editedFields, setEditedFields] = useState<string[]>([]);
  const editedSinceSubmit = useRef<string[]>([]);
  const submittedValues = useRef<Values>(initialValues);
  const blankRef = useRef(initialValues);
  const formRef = useRef<HTMLFormElement>(null);
  const handledState = useRef<SettingsFormState | null>(null);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;
  const onPendingChangeRef = useRef(onPendingChange);
  onPendingChangeRef.current = onPendingChange;

  const formAction = useCallback(
    (formData: FormData) => {
      // Mark saving before dispatch so a following click cannot unmount us.
      onPendingChangeRef.current?.(true);
      setEditedFields([]);
      editedSinceSubmit.current = [];
      const submitted: Values = {};
      for (const field of Object.keys(blankRef.current)) {
        const raw = formData.get(field);
        if (typeof raw === "string") submitted[field] = raw;
      }
      submittedValues.current = submitted;
      dispatch(formData);
    },
    [dispatch],
  );

  useEffect(() => {
    if (!pending) onPendingChangeRef.current?.(false);
  }, [pending]);

  useEffect(() => {
    return () => onPendingChangeRef.current?.(false);
  }, []);

  useEffect(() => {
    if (state.status === "idle") return;
    if (handledState.current === state) return;
    handledState.current = state;
    if (state.status === "error") {
      const invalid = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
      invalid?.focus();
      return;
    }
    const typedDuringSave = editedSinceSubmit.current;
    const preservedEdits = typedDuringSave.length > 0;
    if (clearOnSuccess) {
      setValues((previous) =>
        applyCreateSuccessValues(previous, blankRef.current, typedDuringSave),
      );
      setBaseline(blankRef.current);
    } else {
      const saved = state.values ?? submittedValues.current;
      setValues((previous) => applySavedValues(previous, saved, typedDuringSave));
      setBaseline((previous) => ({ ...previous, ...saved }));
    }
    onSuccessRef.current?.(state, { preservedEdits });
  }, [state, clearOnSuccess]);

  const setField = useCallback((name: string, value: string) => {
    setValues((previous) => ({ ...previous, [name]: value }));
    if (!editedSinceSubmit.current.includes(name)) {
      editedSinceSubmit.current = [...editedSinceSubmit.current, name];
    }
    setEditedFields((previous) => (previous.includes(name) ? previous : [...previous, name]));
  }, []);

  const dirty = useMemo(() => !sameValues(values, baseline), [values, baseline]);

  useDirtyRegistration(dirtyKey, dirty);

  const reset = useCallback(() => {
    setValues(baseline);
    setEditedFields([]);
  }, [baseline]);

  const errorFor = useCallback(
    (name: string) =>
      state.status === "error" && !editedFields.includes(name)
        ? state.fieldErrors[name]
        : undefined,
    [state, editedFields],
  );

  return {
    state,
    formAction,
    formRef,
    pending,
    values,
    setField,
    dirty,
    reset,
    errorFor,
  };
}

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
  onCancelDirty,
  cancelLabel = "Cancel",
  state,
  idleHint,
}: {
  saveLabel: string;
  savingLabel?: string;
  pending: boolean;
  dirty: boolean;
  onDiscard?: () => void;
  /** Idle close — must not run a dirty/confirm check. */
  onCancel?: () => void;
  /** Only used when the form is dirty. */
  onCancelDirty?: () => void;
  cancelLabel?: string;
  state: SettingsFormState;
  idleHint?: string;
}) {
  const secondary = onCancel ? (
    <Button
      type="button"
      variant="outline"
      onClick={dirty ? (onCancelDirty ?? onCancel) : onCancel}
      disabled={pending}
    >
      {cancelLabel}
    </Button>
  ) : (
    <Button type="button" variant="outline" onClick={onDiscard} disabled={!dirty || pending}>
      Discard
    </Button>
  );

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row-reverse sm:items-center">
      <div className="flex shrink-0 gap-2">
        <Button type="submit" disabled={pending} aria-busy={pending || undefined}>
          {pending ? savingLabel : saveLabel}
        </Button>
        {secondary}
      </div>
      <SectionStatus state={state} pending={pending} dirty={dirty} idleHint={idleHint} />
    </div>
  );
}

/**
 * A single-item action (toggle, delete, deactivate) with its own pending and
 * result state. Destructive actions ask for confirmation in a modal first.
 */
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
  const [state, formAction, pending] = useActionState(action, IDLE_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const buttonVariant = variant === "danger" ? "destructive" : "outline";
  const busy = pending || disabled;

  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className ?? ""}`}>
      <form ref={formRef} action={formAction}>
        <input type="hidden" name="id" value={id} />
        {extraFields
          ? Object.entries(extraFields).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))
          : null}
        <Button
          type={confirm ? "button" : "submit"}
          variant={buttonVariant}
          size="sm"
          disabled={busy}
          aria-busy={pending || undefined}
          onClick={confirm ? () => setOpen(true) : undefined}
        >
          {pending ? pendingLabel : label}
        </Button>
      </form>
      {state.status !== "idle" ? (
        <p
          role="status"
          aria-live="polite"
          className={`text-xs leading-relaxed text-pretty ${
            state.status === "error" ? "text-destructive" : "text-success"
          }`}
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
                  formRef.current?.requestSubmit();
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
