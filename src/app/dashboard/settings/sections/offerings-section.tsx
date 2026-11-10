"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SettingsFormState } from "../form-state";
import { createOfferingAction, toggleOfferingAction, updateOfferingAction } from "../actions";
import { formatAgeRange, formatCount, nullToEmpty } from "../format";
import { offeringSchema } from "../schemas";
import { sectionHref } from "../sections";
import { Badge, Callout, EmptyState, FieldGroup } from "../ui/controls";
import { OfferingFields } from "../ui/offering-fields";
import { ItemActionForm, SaveBar, useSettingsForm } from "../ui/settings-form";
import { useTimedAnnouncement } from "../ui/use-timed-announcement";

export type OfferingItem = {
  id: string;
  name: string;
  description: string | null;
  minimumAge: number | null;
  maximumAge: number | null;
  attire: string | null;
  expectations: string | null;
  active: boolean;
  windowCount: number;
  activeWindowCount: number;
  updatedAt: string;
};

const BLANK = {
  name: "",
  description: "",
  minimumAge: "",
  maximumAge: "",
  attire: "",
  expectations: "",
  waiverNotes: "",
};

export function OfferingsSection({ offerings }: { offerings: OfferingItem[] }) {
  const [editor, setEditor] = useState<{ offering?: OfferingItem } | null>(null);
  const [announcement, setAnnouncement] = useTimedAnnouncement();
  const opener = useRef<HTMLButtonElement | null>(null);
  const savedId = useRef<string | undefined>(undefined);
  const activeCount = offerings.filter((offering) => offering.active).length;
  const open = (button: HTMLButtonElement, offering?: OfferingItem) => {
    opener.current = button;
    savedId.current = undefined;
    setAnnouncement(null);
    setEditor({ offering });
  };
  return (
    <div className="flex flex-col gap-6">
      <Callout>
        Age ranges decide who can book. A child outside every range is told they are not eligible.
      </Callout>
      {announcement ? (
        <p role="status" aria-live="polite" className="text-sm text-success">
          {announcement}
        </p>
      ) : null}
      <section className="flex flex-col gap-3" aria-labelledby="offerings-list">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="offerings-list" className="text-sm font-semibold">
            Your trial classes
          </h3>
          <p className="text-xs text-muted-foreground">
            {offerings.length === 0
              ? "None yet"
              : `${formatCount(offerings.length, "class")} · ${activeCount} offered to families`}
          </p>
        </div>
        {offerings.length === 0 ? (
          <EmptyState title="No trial classes yet">
            Add what a family books — for example “Kids beginner trial”.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {offerings.map((offering) => (
              <OfferingRow
                key={offering.id}
                offering={offering}
                onEdit={(button) => open(button, offering)}
              />
            ))}
          </ul>
        )}
      </section>
      <div>
        <Button type="button" variant="outline" onClick={(event) => open(event.currentTarget)}>
          Add a Trial Class
        </Button>
      </div>
      <Dialog
        open={editor !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setEditor(null);
        }}
      >
        <DialogContent
          className="max-h-[90dvh] overflow-y-auto"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const saved = savedId.current
              ? document
                  .getElementById(`offering-${savedId.current}`)
                  ?.querySelector<HTMLButtonElement>("button")
              : null;
            (saved ?? opener.current)?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {editor?.offering ? `Edit “${editor.offering.name}”` : "Add a trial class"}
            </DialogTitle>
            <DialogDescription>
              {editor?.offering
                ? "Saved changes are used by your agent right away."
                : "New trial classes are offered to families as soon as they are added."}
            </DialogDescription>
          </DialogHeader>
          {editor ? (
            <OfferingForm
              offering={editor.offering}
              onCancel={() => setEditor(null)}
              onSuccess={(state) => {
                setAnnouncement(state.message);
                savedId.current = editor.offering?.id ?? state.values?.id;
                setEditor(null);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OfferingRow({
  offering,
  onEdit,
}: {
  offering: OfferingItem;
  onEdit: (button: HTMLButtonElement) => void;
}) {
  const bookable = offering.active && offering.activeWindowCount > 0;
  return (
    <li id={`offering-${offering.id}`} className="flex flex-col gap-3 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-medium text-pretty">{offering.name}</h4>
            {offering.active ? (
              <Badge tone="active">Offered</Badge>
            ) : (
              <Badge tone="muted">Not offered</Badge>
            )}
            <Badge>{formatAgeRange(offering.minimumAge, offering.maximumAge)}</Badge>
          </div>
          {offering.description ? (
            <p className="line-clamp-3 max-w-prose text-sm leading-relaxed text-pretty text-muted-foreground">
              {offering.description}
            </p>
          ) : null}
          {offering.attire ? (
            <p className="text-xs text-muted-foreground">What to wear: {offering.attire}</p>
          ) : null}
          {offering.active && offering.activeWindowCount === 0 ? (
            <p className="text-xs text-pretty text-muted-foreground">
              Offered, but not bookable yet — add a weekly class time.{" "}
              <Link href={sectionHref("schedule")} className="underline-offset-4 hover:underline">
                Add a class time
              </Link>
            </p>
          ) : bookable ? (
            <p className="text-xs text-muted-foreground">
              {formatCount(offering.activeWindowCount, "weekly class time")} available to book
            </p>
          ) : offering.windowCount === 0 ? (
            <p className="text-xs text-muted-foreground">No weekly class times yet.</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Turned off, so its class times are not offered.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-start gap-2 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={(event) => onEdit(event.currentTarget)}
          >
            Edit
          </Button>
          <ItemActionForm
            action={toggleOfferingAction}
            id={offering.id}
            extraFields={{ active: offering.active ? "false" : "true" }}
            label={offering.active ? "Stop Offering" : "Offer Again"}
            pendingLabel={offering.active ? "Turning off…" : "Turning on…"}
            className="sm:items-end"
            confirm={
              offering.active
                ? {
                    title: `Stop offering “${offering.name}”?`,
                    body: (
                      <>
                        Families will no longer be able to book it. Trials already booked are not
                        cancelled.
                      </>
                    ),
                    confirmLabel: "Stop Offering",
                  }
                : undefined
            }
          />
        </div>
      </div>
    </li>
  );
}

function OfferingForm({
  offering,
  onCancel,
  onSuccess,
}: {
  offering?: OfferingItem;
  onCancel: () => void;
  onSuccess: (state: SettingsFormState) => void;
}) {
  const { state, onSubmit, pending, control, dirty } = useSettingsForm({
    action: offering ? updateOfferingAction : createOfferingAction,
    schema: offeringSchema,
    initialValues: offering
      ? {
          id: offering.id,
          updatedAt: offering.updatedAt,
          name: offering.name,
          description: nullToEmpty(offering.description),
          minimumAge: nullToEmpty(offering.minimumAge),
          maximumAge: nullToEmpty(offering.maximumAge),
          attire: nullToEmpty(offering.attire),
          expectations: nullToEmpty(offering.expectations),
          waiverNotes: "",
        }
      : BLANK,
    onSuccess,
  });
  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
      <FieldGroup>
        {offering ? (
          <Callout>
            Bookings already made keep the class name, ages, and instructions from when they were
            booked. New bookings use these settings.
          </Callout>
        ) : null}
        <OfferingFields control={control} disabled={pending} />
      </FieldGroup>
      <SaveBar
        saveLabel={offering ? "Save Changes" : "Add Trial Class"}
        savingLabel={offering ? "Saving…" : "Adding…"}
        pending={pending}
        dirty={dirty}
        onCancel={onCancel}
        state={state}
        idleHint={
          offering
            ? "Saved changes are used by your agent right away."
            : "New trial classes are offered to families as soon as they are added."
        }
      />
    </form>
  );
}
