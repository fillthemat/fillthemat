"use client";

import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { updatePricingAction } from "../actions";
import { LIMITS, pricingSchema } from "../schemas";
import { Callout, TextAreaField } from "../ui/controls";
import { SaveBar, useSettingsForm } from "../ui/settings-form";

const EXAMPLE = `Trial class: free for first-time students.
Kids program: $120 per month, no sign-up fee.
Adults program: $140 per month, or $75 for four classes.
Uniform: $60, ordered after the first month.
Family discount: 10% off for each additional sibling.`;

export function PricingSection({ pricing }: { pricing: string }) {
  const { state, onSubmit, pending, control, values, setField, dirty, reset } = useSettingsForm({
    action: updatePricingAction,
    initialValues: { pricing },
    schema: pricingSchema,
  });

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
      <Callout>
        Your agent shares only what you write here. It will not invent discounts or guess a missing
        price.
      </Callout>

      <FieldGroup>
        <TextAreaField
          label="Prices and conditions your agent may share"
          name="pricing"
          rows={10}
          maxLength={LIMITS.pricing}
          control={control}
          placeholder="Trial class: free for first-time students…"
        />
      </FieldGroup>

      {(values.pricing ?? "").trim().length === 0 ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm font-medium">Example</p>
          <pre className="max-w-full overflow-x-auto text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
            {EXAMPLE}
          </pre>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setField("pricing", EXAMPLE)}
          >
            Start From This Example
          </Button>
        </div>
      ) : null}

      <SaveBar
        saveLabel="Save Pricing"
        pending={pending}
        dirty={dirty}
        onDiscard={reset}
        state={state}
        idleHint="Saved pricing is available to your agent right away."
      />
    </form>
  );
}
