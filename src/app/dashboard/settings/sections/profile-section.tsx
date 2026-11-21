"use client";

import { updateProfileAction } from "../actions";
import { formatTimezone } from "../format";
import { LIMITS, profileSchema, publicAddressSchema } from "../schemas";
import { Callout, FieldGroup, SelectField, TextAreaField, TextField } from "../ui/controls";
import { SaveBar, useSettingsForm } from "../ui/settings-form";

export type ProfileValues = {
  name: string;
  slug: string;
  timezone: string;
  notificationEmail: string;
  phone: string;
  website: string;
  address: string;
  city: string;
  country: string;
  parkingNotes: string;
  accessNotes: string;
  trialGuidance: string;
};

export function ProfileSection({
  initialValues,
  published,
  timezones,
}: {
  initialValues: ProfileValues;
  published: boolean;
  timezones: string[];
}) {
  const { state, onSubmit, pending, control, dirty, reset } = useSettingsForm({
    action: updateProfileAction,
    initialValues,
    schema: published ? profileSchema : profileSchema.extend(publicAddressSchema.shape),
  });

  const lockedBadge = published ? "Locked" : undefined;

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
      {published ? (
        <Callout tone="locked" title="Published page">
          Public address and time zone stay locked so shared links and booked classes keep working.
        </Callout>
      ) : null}

      <FieldGroup title="School identity">
        <TextField
          label="School name"
          name="name"
          required
          autoComplete="organization"
          maxLength={LIMITS.schoolName}
          control={control}
          placeholder="Northside Martial Arts…"
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Public page address"
            name="slug"
            disabled={published}
            badge={lockedBadge}
            control={control}
            spellCheck={false}
            placeholder="northside-martial-arts…"
            helper={
              published
                ? `Locked. Families reach you at /s/${initialValues.slug}.`
                : "Lowercase letters, numbers, and hyphens. Locks once you publish."
            }
          />
          <SelectField
            label="Time zone"
            name="timezone"
            disabled={published}
            badge={lockedBadge}
            control={control}
            helper={
              published
                ? "Locked after publishing. Class times use this zone."
                : "Class times use this zone. Locks once you publish."
            }
            options={(published ? [initialValues.timezone] : timezones).map((zone) => ({
              value: zone,
              label: formatTimezone(zone),
            }))}
          />
        </div>
      </FieldGroup>

      <FieldGroup title="Contact and location">
        <TextField
          label="Notification email"
          name="notificationEmail"
          type="email"
          required
          autoComplete="email"
          spellCheck={false}
          inputMode="email"
          control={control}
          helper="Booking and lead alerts. Internal only — never shared with families."
          placeholder="owner@example.com…"
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Phone number"
            name="phone"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            maxLength={LIMITS.phone}
            control={control}
            placeholder="(555) 123-4567…"
          />
          <TextField
            label="Website"
            name="website"
            type="url"
            autoComplete="url"
            spellCheck={false}
            maxLength={LIMITS.website}
            control={control}
            placeholder="https://example.com…"
          />
        </div>
        <TextField
          label="Street address"
          name="address"
          autoComplete="street-address"
          maxLength={LIMITS.address}
          control={control}
          placeholder="120 Main Street, Suite 3…"
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="City"
            name="city"
            autoComplete="address-level2"
            maxLength={LIMITS.city}
            control={control}
            placeholder="Austin…"
          />
          <TextField
            label="Country code"
            name="country"
            autoComplete="country"
            spellCheck={false}
            maxLength={2}
            control={control}
            helper="Two letters, such as US or CA."
            placeholder="US…"
            variant="uppercase"
          />
        </div>
      </FieldGroup>

      <FieldGroup title="Arriving for a trial class">
        <TextAreaField
          label="Parking"
          name="parkingNotes"
          rows={3}
          maxLength={LIMITS.parkingNotes}
          control={control}
          placeholder="Free lot behind the building, plus street parking after 6 PM…"
        />
        <TextAreaField
          label="Finding the entrance"
          name="accessNotes"
          rows={3}
          maxLength={LIMITS.accessNotes}
          control={control}
          placeholder="Use the glass door on the left side of the plaza; we are on the second floor…"
        />
        <TextAreaField
          label="What to do on arrival"
          name="trialGuidance"
          rows={3}
          maxLength={LIMITS.trialGuidance}
          control={control}
          helper="Class-specific clothing belongs in Trial classes."
          placeholder="Arrive 10 minutes early, check in at the front desk, parents watch from the benches…"
        />
      </FieldGroup>

      <SaveBar
        saveLabel="Save School Details"
        pending={pending}
        dirty={dirty}
        onDiscard={reset}
        state={state}
        idleHint="Saved changes are used by your agent right away."
      />
    </form>
  );
}
