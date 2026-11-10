"use client";

import { updateBrandingAction } from "../actions";
import { brandingSchema, LIMITS } from "../schemas";
import { Callout, FieldGroup, TextField } from "../ui/controls";
import { PreviewPanel } from "../ui/preview-panel";
import { PublicPagePreview } from "../ui/public-page-preview";
import { SaveBar, useSettingsForm } from "../ui/settings-form";

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
  const { state, onSubmit, pending, control, values, setField, dirty, reset } = useSettingsForm({
    action: updateBrandingAction,
    initialValues: { logoUrl, primaryColor },
    schema: brandingSchema,
  });

  const pickerValue = /^#[0-9A-Fa-f]{6}$/.test(values.primaryColor ?? "")
    ? values.primaryColor
    : "#111111";

  return (
    <div className="grid gap-6 xl:grid-cols-(--settings-page-columns)">
      <form noValidate onSubmit={onSubmit} className="flex min-w-0 flex-col gap-5">
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
            control={control}
            helper="Must start with https:// and point at a .png, .jpg, or .svg file."
            placeholder="https://example.com/logo.png…"
          />

          <TextField
            control={control}
            label="Accent color"
            name="primaryColor"
            spellCheck={false}
            autoComplete="off"
            maxLength={7}
            placeholder="#1E3A8A…"
            helper="6-digit hex, such as #1E3A8A. Blank uses the default dark accent."
            variant="code"
            adornment={
              <input
                type="color"
                aria-label="Choose accent color with a color picker"
                value={pickerValue}
                onChange={(event) => setField("primaryColor", event.target.value.toUpperCase())}
                className="h-11 w-12 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-1 md:h-9"
              />
            }
          />
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
