"use client";

import type { ComponentProps } from "react";
import { LIMITS } from "../schemas";
import { TextAreaField, TextField } from "./controls";

export function FaqFields({
  control,
  disabled = false,
}: {
  control: ComponentProps<typeof TextField>["control"];
  disabled?: boolean;
}) {
  return (
    <>
      <TextField
        label="Question"
        name="question"
        required
        disabled={disabled}
        maxLength={LIMITS.faqQuestion}
        showCount
        control={control}
        placeholder="Do we need a uniform for the first class?…"
      />
      <TextAreaField
        label="Answer"
        name="answer"
        required
        disabled={disabled}
        rows={5}
        maxLength={LIMITS.faqAnswer}
        control={control}
        placeholder="No. Comfortable clothes are fine for the trial class…"
      />
    </>
  );
}
