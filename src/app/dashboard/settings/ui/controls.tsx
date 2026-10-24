"use client";

import { useId } from "react";
import { type Control, Controller, type ControllerRenderProps } from "react-hook-form";
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
import type { SettingsValues } from "./settings-form";

type FieldProps = {
  control: Control<SettingsValues, unknown, Record<string, unknown>>;
  name: string;
  label: string;
  helper?: string;
  required?: boolean;
  disabled?: boolean;
  badge?: string;
  maxLength?: number;
  showCount?: boolean;
  /** Rendered inline before the control, e.g. a colour swatch. */
  adornment?: React.ReactNode;
};

function ControlledField({
  control,
  name,
  label,
  helper,
  required,
  disabled,
  badge,
  maxLength,
  showCount,
  adornment,
  children,
}: FieldProps & {
  children: (props: ControlProps) => React.ReactNode;
}) {
  const id = useId();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid} data-disabled={disabled} className="min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <FieldLabel htmlFor={id}>
              {label}
              {required ? (
                <span className="ml-1 text-muted-foreground" aria-hidden="true">
                  *
                </span>
              ) : null}
            </FieldLabel>
            {badge ? <UiBadge variant="muted">{badge}</UiBadge> : null}
          </div>
          {adornment ? (
            <div className="flex items-center gap-2">
              {adornment}
              <div className="min-w-0 flex-1">
                {children({
                  ...field,
                  id,
                  disabled,
                  "aria-invalid": fieldState.invalid,
                  "aria-required": required || undefined,
                })}
              </div>
            </div>
          ) : (
            children({
              ...field,
              id,
              disabled,
              "aria-invalid": fieldState.invalid,
              "aria-required": required || undefined,
            })
          )}
          {helper || (showCount && maxLength) ? (
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              {helper ? <FieldDescription>{helper}</FieldDescription> : null}
              {showCount && maxLength ? (
                <p
                  className={cn(
                    "text-xs tabular-nums",
                    field.value.length > maxLength ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {field.value.length.toLocaleString("en-US")} / {maxLength.toLocaleString("en-US")}
                </p>
              ) : null}
            </div>
          ) : null}
          {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
        </Field>
      )}
    />
  );
}

// Shared native control props retain RHF's ref, blur and change handlers.
type ControlProps = ControllerRenderProps<SettingsValues> & {
  id: string;
  disabled?: boolean;
  "aria-invalid": boolean;
  "aria-required"?: boolean;
};

export function TextField({
  type = "text",
  placeholder,
  maxLength,
  autoComplete = "off",
  spellCheck,
  inputMode,
  min,
  max,
  step,
  variant = "default",
  ...props
}: FieldProps & {
  type?: "text" | "email" | "tel" | "url" | "number" | "time";
  placeholder?: string;
  autoComplete?: string;
  spellCheck?: boolean;
  inputMode?: "text" | "numeric" | "tel" | "email" | "url";
  min?: number;
  max?: number;
  step?: number;
  variant?: "default" | "code" | "uppercase";
}) {
  return (
    <ControlledField {...props} maxLength={maxLength}>
      {(field) => (
        <Input
          {...field}
          type={type}
          placeholder={placeholder}
          maxLength={maxLength}
          autoComplete={autoComplete}
          spellCheck={spellCheck}
          inputMode={inputMode}
          min={min}
          max={max}
          step={step}
          variant={variant}
        />
      )}
    </ControlledField>
  );
}

export function TextAreaField({
  placeholder,
  maxLength,
  rows = 4,
  showCount = true,
  ...props
}: FieldProps & { placeholder?: string; rows?: number }) {
  return (
    <ControlledField {...props} maxLength={maxLength} showCount={showCount}>
      {(field) => (
        <Textarea {...field} rows={rows} placeholder={placeholder} maxLength={maxLength} />
      )}
    </ControlledField>
  );
}

export function SelectField({
  options,
  ...props
}: FieldProps & { options: ReadonlyArray<{ value: string; label: string }> }) {
  return (
    <ControlledField {...props}>
      {(field) => (
        <NativeSelect {...field}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
      )}
    </ControlledField>
  );
}

/** Omit `title` where a surrounding heading (such as a dialog title) already names the group. */
export function FieldGroup({
  title,
  description,
  children,
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
}) {
  if (!title) return <UiFieldGroup>{children}</UiFieldGroup>;
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
