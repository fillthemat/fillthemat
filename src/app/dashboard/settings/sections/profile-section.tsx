"use client";

import { updateProfileAction } from "../actions";
import { formatTimezone } from "../format";
import { LIMITS } from "../schemas";
import {
  Callout,
  FieldGroup,
  SelectField,
  TextAreaField,
  TextField,
} from "../ui/controls";
import { SaveBar, useSettingsForm } from "../ui/section-form";

export type ProfileValues = {
  name: string;
  slug: string;
  timezone: string;
  notificationEmail: string;
  publicContactEmail: string;
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
  const {
    state,
    formAction,
    formRef,
    pending,
    values,
    setField,
    dirty,
    reset,
    errorFor,
  } = useSettingsForm({
    action: updateProfileAction,
    initialValues,
    dirtyKey: "profile:details",
  });

  const lockedBadge = published ? "Locked" : undefined;

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-6">
      {published ? (
        <Callout tone="locked" title="Published page">
          Public address and time zone stay locked so shared links and booked
          classes keep working.
        </Callout>
      ) : null}

      <FieldGroup title="School identity">
        <TextField
          label="School name"
          name="name"
          required
          autoComplete="organization"
          maxLength={LIMITS.schoolName}
          value={values.name}
          onValueChange={(value) => setField("name", value)}
          error={errorFor("name")}
          placeholder="Northside Martial Arts…"
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Public page address"
            name="slug"
            disabled={published}
            badge={lockedBadge}
            value={values.slug}
            onValueChange={(value) => setField("slug", value)}
            error={errorFor("slug")}
            spellCheck={false}
            placeholder="northside-martial-arts…"
            helper={
              published
                ? `Locked. Families reach you at /s/${initialValues.slug}.`
                : "Lowercase letters, numbers, and hyphens. Locks once you publish."
            }
          />
          {published ? (
            <TextField
              label="Time zone"
              name="timezoneDisplay"
              disabled
              badge={lockedBadge}
              value={formatTimezone(initialValues.timezone)}
              onValueChange={() => {}}
              helper="Locked after publishing. Class times use this zone."
            />
          ) : (
            <SelectField
              label="Time zone"
              name="timezone"
              value={values.timezone}
              onValueChange={(value) => setField("timezone", value)}
              error={errorFor("timezone")}
              helper="Class times use this zone. Locks once you publish."
              options={timezones.map((zone) => ({
                value: zone,
                label: formatTimezone(zone),
              }))}
            />
          )}
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
          value={values.notificationEmail}
          onValueChange={(value) => setField("notificationEmail", value)}
          error={errorFor("notificationEmail")}
          helper="Booking and lead alerts. Internal only — never shared with families."
          placeholder="owner@example.com…"
        />
        <TextField
          label="Public contact email"
          name="publicContactEmail"
          type="email"
          autoComplete="email"
          spellCheck={false}
          inputMode="email"
          maxLength={254}
          value={values.publicContactEmail}
          onValueChange={(value) => setField("publicContactEmail", value)}
          error={errorFor("publicContactEmail")}
          helper="Shared with prospects who want to reach a person, including in trial emails. Separate from your private notification email."
          placeholder="hello@example.com…"
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Phone number"
            name="phone"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            maxLength={LIMITS.phone}
            value={values.phone}
            onValueChange={(value) => setField("phone", value)}
            error={errorFor("phone")}
            placeholder="(555) 123-4567…"
          />
          <TextField
            label="Website"
            name="website"
            type="url"
            autoComplete="url"
            spellCheck={false}
            maxLength={LIMITS.website}
            value={values.website}
            onValueChange={(value) => setField("website", value)}
            error={errorFor("website")}
            placeholder="https://example.com…"
          />
        </div>
        <TextField
          label="Street address"
          name="address"
          autoComplete="street-address"
          maxLength={LIMITS.address}
          value={values.address}
          onValueChange={(value) => setField("address", value)}
          error={errorFor("address")}
          placeholder="120 Main Street, Suite 3…"
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="City"
            name="city"
            autoComplete="address-level2"
            maxLength={LIMITS.city}
            value={values.city}
            onValueChange={(value) => setField("city", value)}
            error={errorFor("city")}
            placeholder="Austin…"
          />
          <TextField
            label="Country code"
            name="country"
            autoComplete="country"
            spellCheck={false}
            maxLength={2}
            value={values.country}
            onValueChange={(value) => setField("country", value)}
            error={errorFor("country")}
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
          value={values.parkingNotes}
          onValueChange={(value) => setField("parkingNotes", value)}
          error={errorFor("parkingNotes")}
          placeholder="Free lot behind the building, plus street parking after 6 PM…"
        />
        <TextAreaField
          label="Finding the entrance"
          name="accessNotes"
          rows={3}
          maxLength={LIMITS.accessNotes}
          value={values.accessNotes}
          onValueChange={(value) => setField("accessNotes", value)}
          error={errorFor("accessNotes")}
          placeholder="Use the glass door on the left side of the plaza; we are on the second floor…"
        />
        <TextAreaField
          label="What to do on arrival"
          name="trialGuidance"
          rows={3}
          maxLength={LIMITS.trialGuidance}
          value={values.trialGuidance}
          onValueChange={(value) => setField("trialGuidance", value)}
          error={errorFor("trialGuidance")}
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
