"use client";

import { useId } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge as UiBadge } from "@/components/ui/badge";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup as UiFieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
  disabled,
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
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Field data-invalid={!!error} data-disabled={disabled} className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <FieldLabel htmlFor={controlId}>
          {label}
          {required ? (
            <span className="ml-1 text-muted-foreground" aria-hidden="true">
              *
            </span>
          ) : null}
        </FieldLabel>
        {badge ? <UiBadge variant="muted">{badge}</UiBadge> : null}
      </div>
      {children}
      {helper || count ? (
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          {helper ? <FieldDescription id={helperId}>{helper}</FieldDescription> : null}
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
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </Field>
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
  value = "",
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
  value: string | undefined;
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
      disabled={disabled}
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
  value = "",
  onValueChange,
  placeholder,
  maxLength,
  rows = 4,
  showCount = true,
}: BaseFieldProps & {
  value: string | undefined;
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
      disabled={disabled}
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
  value = "",
  onValueChange,
  options,
}: BaseFieldProps & {
  value: string | undefined;
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
      disabled={disabled}
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
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <FieldSet>
      <FieldLegend>{title}</FieldLegend>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      <UiFieldGroup>{children}</UiFieldGroup>
    </FieldSet>
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
  return (
    <Alert variant={tone === "warning" ? "destructive" : "default"}>
      {title ? <AlertTitle>{title}</AlertTitle> : null}
      <AlertDescription>{children}</AlertDescription>
    </Alert>
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
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{children}</EmptyDescription>
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}
