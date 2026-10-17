"use client";

import { useId } from "react";
import { Badge as UiBadge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type BaseFieldProps = {
  label: string;
  name: string;
  helper?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  /** Shown next to the label, e.g. "Locked after publishing". */
  badge?: string;
};

function describedBy(
  helperId: string,
  helper: string | undefined,
  errorId: string,
  error: string | undefined,
): string | undefined {
  const ids = [helper ? helperId : null, error ? errorId : null].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

function useFieldIds(name: string) {
  const uid = useId();
  return {
    controlId: `${uid}-${name}`,
    helperId: `${uid}-${name}-helper`,
    errorId: `${uid}-${name}-error`,
  };
}

function FieldShell({
  label,
  controlId,
  helperId,
  errorId,
  helper,
  error,
  required,
  badge,
  count,
  children,
}: {
  label: string;
  controlId: string;
  helperId: string;
  errorId: string;
  helper?: string;
  error?: string;
  required?: boolean;
  badge?: string;
  count?: { value: number; max: number };
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Label htmlFor={controlId}>
          {label}
          {required ? (
            <span className="ml-1 text-muted-foreground" aria-hidden="true">
              *
            </span>
          ) : null}
        </Label>
        {badge ? <UiBadge variant="muted">{badge}</UiBadge> : null}
      </div>
      {children}
      {helper || count ? (
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          {helper ? (
            <p id={helperId} className="text-xs leading-relaxed text-muted-foreground">
              {helper}
            </p>
          ) : null}
          {count ? (
            <p
              className={cn(
                "text-xs tabular-nums",
                count.value > count.max ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {count.value.toLocaleString("en-US")} / {count.max.toLocaleString("en-US")}
            </p>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function TextField({
  label,
  name,
  helper,
  error,
  required,
  disabled,
  badge,
  value,
  onValueChange,
  type = "text",
  placeholder,
  maxLength,
  autoComplete = "off",
  spellCheck,
  inputMode,
  showCount = false,
  min,
  max,
  step,
  variant = "default",
}: BaseFieldProps & {
  value: string;
  onValueChange: (value: string) => void;
  type?: "text" | "email" | "tel" | "url" | "number" | "time";
  placeholder?: string;
  maxLength?: number;
  autoComplete?: string;
  spellCheck?: boolean;
  inputMode?: "text" | "numeric" | "tel" | "email" | "url";
  showCount?: boolean;
  min?: number;
  max?: number;
  step?: number;
  variant?: "default" | "code" | "uppercase";
}) {
  const { controlId, helperId, errorId } = useFieldIds(name);
  return (
    <FieldShell
      label={label}
      controlId={controlId}
      helperId={helperId}
      errorId={errorId}
      helper={helper}
      error={error}
      required={required}
      badge={badge}
      count={showCount && maxLength ? { value: value.length, max: maxLength } : undefined}
    >
      <Input
        id={controlId}
        name={name}
        type={type}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        maxLength={maxLength}
        autoComplete={autoComplete}
        spellCheck={spellCheck}
        inputMode={inputMode}
        min={min}
        max={max}
        step={step}
        aria-describedby={describedBy(helperId, helper, errorId, error)}
        aria-invalid={error ? true : undefined}
        aria-required={required || undefined}
        variant={variant}
      />
    </FieldShell>
  );
}

export function TextAreaField({
  label,
  name,
  helper,
  error,
  required,
  disabled,
  badge,
  value,
  onValueChange,
  placeholder,
  maxLength,
  rows = 4,
  showCount = true,
}: BaseFieldProps & {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  rows?: number;
  showCount?: boolean;
}) {
  const { controlId, helperId, errorId } = useFieldIds(name);
  return (
    <FieldShell
      label={label}
      controlId={controlId}
      helperId={helperId}
      errorId={errorId}
      helper={helper}
      error={error}
      required={required}
      badge={badge}
      count={showCount && maxLength ? { value: value.length, max: maxLength } : undefined}
    >
      <Textarea
        id={controlId}
        name={name}
        rows={rows}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        maxLength={maxLength}
        aria-describedby={describedBy(helperId, helper, errorId, error)}
        aria-invalid={error ? true : undefined}
        aria-required={required || undefined}
      />
    </FieldShell>
  );
}

export function SelectField({
  label,
  name,
  helper,
  error,
  required,
  disabled,
  badge,
  value,
  onValueChange,
  options,
}: BaseFieldProps & {
  value: string;
  onValueChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  const { controlId, helperId, errorId } = useFieldIds(name);
  return (
    <FieldShell
      label={label}
      controlId={controlId}
      helperId={helperId}
      errorId={errorId}
      helper={helper}
      error={error}
      required={required}
      badge={badge}
    >
      <NativeSelect
        id={controlId}
        name={name}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        disabled={disabled}
        aria-describedby={describedBy(helperId, helper, errorId, error)}
        aria-invalid={error ? true : undefined}
        aria-required={required || undefined}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
    </FieldShell>
  );
}

export function FieldGroup({
  title,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-base font-semibold">{title}</legend>
      {children}
    </fieldset>
  );
}

export function Callout({
  tone = "neutral",
  title,
  children,
}: {
  tone?: "neutral" | "locked" | "warning";
  title?: string;
  children: React.ReactNode;
}) {
  const tones = {
    neutral: "border-border text-muted-foreground",
    locked: "border-border text-muted-foreground",
    warning: "border-warning/40 text-warning",
  } as const;
  return (
    <div className={cn("rounded-md border px-3 py-2 text-sm text-pretty", tones[tone])}>
      {title ? <p className="font-medium text-foreground">{title}</p> : null}
      <div className={title ? "mt-1" : undefined}>{children}</div>
    </div>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "muted" | "active" | "warning";
  children: React.ReactNode;
}) {
  const variant = {
    neutral: "outline",
    muted: "muted",
    active: "success",
    warning: "warning",
  } as const;
  return <UiBadge variant={variant[tone]}>{children}</UiBadge>;
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-2 py-2">
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-prose text-sm leading-relaxed text-pretty text-muted-foreground">
        {children}
      </p>
      {action}
    </div>
  );
}
