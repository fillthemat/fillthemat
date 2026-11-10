"use client";

import type { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { IDLE_STATE, type SettingsFormState } from "../form-state";

export type SettingsValues = Record<string, string>;
export type SettingsAction = (values: SettingsValues) => Promise<SettingsFormState>;

/** Validate in the browser, but send raw strings for authoritative server parsing. */
export function useSettingsForm({
  action,
  schema,
  initialValues,
  clearOnSuccess = false,
  onSuccess,
}: {
  action: SettingsAction;
  schema: z.ZodType<Record<string, unknown>, SettingsValues>;
  initialValues: SettingsValues;
  clearOnSuccess?: boolean;
  onSuccess?: (state: SettingsFormState) => void;
}) {
  const form = useForm<SettingsValues, unknown, Record<string, unknown>>({
    resolver: zodResolver(schema),
    mode: "onTouched",
    defaultValues: initialValues,
  });
  const [state, setState] = useState(IDLE_STATE);
  const [pending, startTransition] = useTransition();
  const onSubmit = form.handleSubmit(() => {
    const values = form.getValues();
    startTransition(async () => {
      const result = await action(values);
      setState(result);
      if (result.status === "error") {
        Object.entries(result.fieldErrors).forEach(([name, message], index) => {
          form.setError(name, { message }, { shouldFocus: index === 0 });
        });
      } else if (result.status === "success") {
        form.reset(clearOnSuccess ? initialValues : { ...values, ...result.values });
        onSuccess?.(result);
      }
    });
  });

  return {
    state,
    onSubmit,
    pending,
    control: form.control,
    values: form.watch(),
    setField: (name: string, value: string) =>
      form.setValue(name, value, { shouldDirty: true, shouldValidate: true }),
    dirty: form.formState.isDirty,
    reset: () => form.reset(),
  };
}

export { ItemActionForm, SaveBar, SectionStatus } from "./save-bar";
