"use client";

import { LIMITS } from "../schemas";
import { TextAreaField, TextField } from "./controls";

export function OfferingFields({
  values,
  setField,
  errorFor,
  disabled = false,
}: {
  values: Record<string, string>;
  setField: (name: string, value: string) => void;
  errorFor: (name: string) => string | undefined;
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
        value={values.name}
        onValueChange={(value) => setField("name", value)}
        error={errorFor("name")}
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
          value={values.minimumAge}
          onValueChange={(value) => setField("minimumAge", value)}
          error={errorFor("minimumAge")}
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
          value={values.maximumAge}
          onValueChange={(value) => setField("maximumAge", value)}
          error={errorFor("maximumAge")}
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
        value={values.description}
        onValueChange={(value) => setField("description", value)}
        error={errorFor("description")}
        placeholder="A 45-minute beginner class focused on basics, games, and safety…"
      />
      <TextField
        label="What to wear"
        name="attire"
        disabled={disabled}
        maxLength={LIMITS.offeringAttire}
        value={values.attire}
        onValueChange={(value) => setField("attire", value)}
        error={errorFor("attire")}
        placeholder="Comfortable clothes and bare feet…"
      />
      <TextAreaField
        label="What to expect in class"
        name="expectations"
        rows={3}
        disabled={disabled}
        maxLength={LIMITS.offeringExpectations}
        value={values.expectations}
        onValueChange={(value) => setField("expectations", value)}
        error={errorFor("expectations")}
        placeholder="Warm-up, partner drills with an instructor, and time for questions afterward…"
      />
    </>
  );
}
