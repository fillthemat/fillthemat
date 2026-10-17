"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { SettingsFormState } from "../form-state";
import { createOfferingAction, toggleOfferingAction, updateOfferingAction } from "../actions";
import { nullToEmpty } from "../form-utils";
import { formatAgeRange, formatCount } from "../format";
import { sectionHref } from "../sections";
import { Badge, Callout, EmptyState, FieldGroup } from "../ui/controls";
import { DiscardEditsDialog, useRecordEditor, useTimedAnnouncement } from "../ui/editor-lifecycle";
import { OfferingFields } from "../ui/offering-fields";
import { ItemActionForm, SaveBar, type SaveSuccessMeta, useSettingsForm } from "../ui/section-form";

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
};

function offeringValues(offering: OfferingItem) {
  return {
    name: offering.name,
    description: nullToEmpty(offering.description),
    minimumAge: nullToEmpty(offering.minimumAge),
    maximumAge: nullToEmpty(offering.maximumAge),
    attire: nullToEmpty(offering.attire),
    expectations: nullToEmpty(offering.expectations),
    updatedAt: offering.updatedAt,
  };
}

export function OfferingsSection({ offerings }: { offerings: OfferingItem[] }) {
  const editor = useRecordEditor("offerings");
  const [announcement, setAnnouncement] = useTimedAnnouncement();
  const [focusId, setFocusId] = useState<string | null>(null);
  const nameRef = useRef<HTMLDivElement>(null);
  const activeCount = offerings.filter((offering) => offering.active).length;

  useEffect(() => {
    if (editor.isCreating) {
      requestAnimationFrame(() => {
        nameRef.current?.querySelector("input")?.focus();
      });
    }
  }, [editor.isCreating]);

  const openAdd = () => {
    setAnnouncement(null);
    editor.requestOpen({ type: "create" });
  };

  const onCreateSuccess = (state: SettingsFormState, meta: SaveSuccessMeta) => {
    if (state.message) setAnnouncement(state.message);
    if (meta.preservedEdits) return;
    const id = state.values?.id;
    editor.closeImmediate();
    if (id) setFocusId(id);
  };

  const onEditSuccess = (id: string, state: SettingsFormState, meta: SaveSuccessMeta) => {
    if (state.message) setAnnouncement(state.message);
    if (meta.preservedEdits) return;
    editor.closeImmediate();
    setFocusId(id);
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

        {offerings.length === 0 && !editor.isCreating ? (
          <EmptyState
            title="No trial classes yet"
            action={
              <Button type="button" variant="outline" onClick={openAdd} disabled={editor.saving}>
                Add a Trial Class
              </Button>
            }
          >
            Add what a family books — for example “Kids beginner trial”.
          </EmptyState>
        ) : offerings.length === 0 ? null : (
          <ul className="divide-y divide-border border-y border-border">
            {offerings.map((offering) => (
              <OfferingRow
                key={offering.id}
                offering={offering}
                editing={editor.isEditing(offering.id)}
                categorySaving={editor.saving}
                onEdit={() => {
                  setAnnouncement(null);
                  editor.requestOpen({ type: "edit", id: offering.id });
                }}
                onIdleClose={editor.closeImmediate}
                onDirtyClose={() => editor.requestCancel(true)}
                onSuccess={(state, meta) => onEditSuccess(offering.id, state, meta)}
                onPendingChange={editor.setSaving}
                editRef={(node) => {
                  if (node && focusId === offering.id) {
                    node.focus();
                    setFocusId(null);
                  }
                }}
              />
            ))}
          </ul>
        )}
      </section>

      {editor.isCreating ? (
        <div ref={nameRef}>
          <CreateOfferingForm
            onIdleClose={editor.closeImmediate}
            onDirtyClose={() => editor.requestCancel(true)}
            onSuccess={onCreateSuccess}
            onPendingChange={editor.setSaving}
          />
        </div>
      ) : (
        <div>
          <Button type="button" variant="outline" onClick={openAdd} disabled={editor.saving}>
            Add a Trial Class
          </Button>
        </div>
      )}

      <DiscardEditsDialog
        open={editor.pendingTarget !== null && !editor.saving}
        onKeepEditing={editor.keepEditing}
        onDiscard={editor.discardAndSwitch}
      />
    </div>
  );
}

function OfferingRow({
  offering,
  editing,
  categorySaving,
  onEdit,
  onIdleClose,
  onDirtyClose,
  onSuccess,
  onPendingChange,
  editRef,
}: {
  offering: OfferingItem;
  editing: boolean;
  categorySaving: boolean;
  onEdit: () => void;
  onIdleClose: () => void;
  onDirtyClose: () => void;
  onSuccess: (state: SettingsFormState, meta: SaveSuccessMeta) => void;
  onPendingChange: (pending: boolean) => void;
  editRef: (node: HTMLButtonElement | null) => void;
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
            ref={editRef}
            type="button"
            variant="outline"
            size="sm"
            onClick={onEdit}
            disabled={categorySaving}
            aria-expanded={editing}
            aria-controls={editing ? `offering-editor-${offering.id}` : undefined}
          >
            Edit
          </Button>
          <ItemActionForm
            action={toggleOfferingAction}
            id={offering.id}
            extraFields={{ active: offering.active ? "false" : "true" }}
            label={offering.active ? "Stop Offering" : "Offer Again"}
            pendingLabel={offering.active ? "Turning off…" : "Turning on…"}
            disabled={editing && categorySaving}
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
      {editing ? (
        <EditOfferingForm
          offering={offering}
          onIdleClose={onIdleClose}
          onDirtyClose={onDirtyClose}
          onSuccess={onSuccess}
          onPendingChange={onPendingChange}
        />
      ) : null}
    </li>
  );
}

function CreateOfferingForm({
  onIdleClose,
  onDirtyClose,
  onSuccess,
  onPendingChange,
}: {
  onIdleClose: () => void;
  onDirtyClose: () => void;
  onSuccess: (state: SettingsFormState, meta: SaveSuccessMeta) => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const { state, formAction, formRef, pending, values, setField, dirty, errorFor } =
    useSettingsForm({
      action: createOfferingAction,
      initialValues: BLANK,
      dirtyKey: "offerings:new",
      clearOnSuccess: true,
      onSuccess,
      onPendingChange,
    });

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-5">
      <FieldGroup title="Add a trial class">
        <OfferingFields
          values={values}
          setField={setField}
          errorFor={errorFor}
          disabled={pending}
        />
      </FieldGroup>
      <SaveBar
        saveLabel="Add Trial Class"
        savingLabel="Adding…"
        pending={pending}
        dirty={dirty}
        onCancel={onIdleClose}
        onCancelDirty={onDirtyClose}
        state={state}
        idleHint="New trial classes are offered to families as soon as they are added."
      />
    </form>
  );
}

function EditOfferingForm({
  offering,
  onIdleClose,
  onDirtyClose,
  onSuccess,
  onPendingChange,
}: {
  offering: OfferingItem;
  onIdleClose: () => void;
  onDirtyClose: () => void;
  onSuccess: (state: SettingsFormState, meta: SaveSuccessMeta) => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const { state, formAction, formRef, pending, values, setField, dirty, errorFor } =
    useSettingsForm({
      action: updateOfferingAction,
      initialValues: offeringValues(offering),
      dirtyKey: `offerings:edit:${offering.id}`,
      onSuccess,
      onPendingChange,
    });

  return (
    <form
      id={`offering-editor-${offering.id}`}
      ref={formRef}
      action={formAction}
      className="flex flex-col gap-5 rounded-md border border-border p-4"
    >
      <input type="hidden" name="id" value={offering.id} />
      <input type="hidden" name="updatedAt" value={values.updatedAt} />
      <FieldGroup title={`Edit “${offering.name}”`}>
        <Callout>
          Bookings already made keep the class name, ages, and instructions from when they were
          booked. New bookings use these settings.
        </Callout>
        <OfferingFields
          values={values}
          setField={setField}
          errorFor={errorFor}
          disabled={pending}
        />
      </FieldGroup>
      <SaveBar
        saveLabel="Save Changes"
        savingLabel="Saving…"
        pending={pending}
        dirty={dirty}
        onCancel={onIdleClose}
        onCancelDirty={onDirtyClose}
        state={state}
        idleHint="Saved changes are used by your agent right away."
      />
    </form>
  );
}
