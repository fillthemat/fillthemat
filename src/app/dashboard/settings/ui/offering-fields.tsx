"use client";

import type { ComponentProps } from "react";
import { LIMITS } from "../schemas";
import { TextAreaField, TextField } from "./controls";

export function OfferingFields({
  control,
  disabled = false,
}: {
  control: ComponentProps<typeof TextField>["control"];
  disabled?: boolean;
}) {
  return (
    <>
      <TextField
        label="Class name"
        name="name"
        required
        disabled={disabled}
        maxLength={LIMITS.offeringName}
        control={control}
        placeholder="Kids beginner trial…"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label="Youngest age"
          name="minimumAge"
          type="number"
          min={0}
          max={99}
          inputMode="numeric"
          disabled={disabled}
          control={control}
          helper="Leave blank for no lower limit."
          placeholder="6…"
        />
        <TextField
          label="Oldest age"
          name="maximumAge"
          type="number"
          min={0}
          max={99}
          inputMode="numeric"
          disabled={disabled}
          control={control}
          helper="Leave blank for no upper limit."
          placeholder="12…"
        />
      </div>
      <p className="text-xs leading-relaxed text-pretty text-muted-foreground">
        Changing age eligibility affects who can book from now on, not existing reservations.
      </p>
      <TextAreaField
        label="Description"
        name="description"
        rows={3}
        disabled={disabled}
        maxLength={LIMITS.offeringDescription}
        control={control}
        placeholder="A 45-minute beginner class focused on basics, games, and safety…"
      />
      <TextField
        label="What to wear"
        name="attire"
        disabled={disabled}
        maxLength={LIMITS.offeringAttire}
        control={control}
        placeholder="Comfortable clothes and bare feet…"
      />
      <TextAreaField
        label="What to expect in class"
        name="expectations"
        rows={3}
        disabled={disabled}
        maxLength={LIMITS.offeringExpectations}
        control={control}
        placeholder="Warm-up, partner drills with an instructor, and time for questions afterward…"
      />
    </>
  );
}
