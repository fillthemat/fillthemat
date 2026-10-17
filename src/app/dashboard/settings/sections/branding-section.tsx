"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateBrandingAction } from "../actions";
import { LIMITS } from "../schemas";
import { Callout, FieldGroup, TextField } from "../ui/controls";
import { PreviewPanel } from "../ui/preview-panel";
import { PublicPagePreview } from "../ui/public-page-preview";
import { SaveBar, useSettingsForm } from "../ui/section-form";

export function BrandingSection({
  logoUrl,
  primaryColor,
  schoolName,
  location,
  welcomeMessage,
}: {
  logoUrl: string;
  primaryColor: string;
  schoolName: string;
  location: string | null;
  welcomeMessage: string;
}) {
  const hexId = useId();
  const { state, formAction, formRef, pending, values, setField, dirty, reset, errorFor } =
    useSettingsForm({
      action: updateBrandingAction,
      initialValues: { logoUrl, primaryColor },
      dirtyKey: "branding:settings",
    });

  const colorError = errorFor("primaryColor");
  const pickerValue = /^#[0-9A-Fa-f]{6}$/.test(values.primaryColor)
    ? values.primaryColor
    : "#111111";

  return (
    <div className="grid gap-6 xl:grid-cols-(--settings-page-columns)">
      <form ref={formRef} action={formAction} className="flex min-w-0 flex-col gap-5">
        <Callout>
          File uploads are not available yet. Paste a public https:// image address.
        </Callout>

        <FieldGroup title="Logo and color">
          <TextField
            label="Logo image address"
            name="logoUrl"
            type="url"
            spellCheck={false}
            maxLength={LIMITS.logoUrl}
            value={values.logoUrl}
            onValueChange={(value) => setField("logoUrl", value)}
            error={errorFor("logoUrl")}
            helper="Must start with https:// and point at a .png, .jpg, or .svg file."
            placeholder="https://example.com/logo.png…"
          />

          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor={hexId}>Accent color</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label="Choose accent color with a color picker"
                value={pickerValue}
                onChange={(event) => setField("primaryColor", event.target.value.toUpperCase())}
                className="h-11 w-12 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-1 md:h-9"
              />
              <Input
                id={hexId}
                name="primaryColor"
                value={values.primaryColor}
                onChange={(event) => setField("primaryColor", event.target.value)}
                spellCheck={false}
                autoComplete="off"
                maxLength={7}
                placeholder="#1E3A8A…"
                aria-describedby={`${hexId}-helper${colorError ? ` ${hexId}-error` : ""}`}
                aria-invalid={colorError ? true : undefined}
                variant="code"
              />
            </div>
            <p id={`${hexId}-helper`} className="text-xs text-muted-foreground">
              6-digit hex, such as #1E3A8A. Blank uses the default dark accent.
            </p>
            {colorError ? (
              <p id={`${hexId}-error`} className="text-xs font-medium text-destructive">
                {colorError}
              </p>
            ) : null}
          </div>
        </FieldGroup>

        <SaveBar
          saveLabel="Save Branding"
          pending={pending}
          dirty={dirty}
          onDiscard={reset}
          state={state}
          idleHint="Saved branding appears on your public page right away."
        />
      </form>

      <PreviewPanel
        title="Public page preview"
        dirty={dirty}
        note="Representative view — spacing and colors on the live page may differ. Nothing here creates a booking."
      >
        <PublicPagePreview
          schoolName={schoolName}
          location={location}
          logoUrl={values.logoUrl}
          accentColor={values.primaryColor}
          welcomeMessage={welcomeMessage}
        />
      </PreviewPanel>
    </div>
  );
}
