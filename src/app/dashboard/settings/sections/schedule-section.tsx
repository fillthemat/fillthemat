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
import { FieldGroup as UiFieldGroup } from "@/components/ui/field";
import type { SettingsFormState } from "../form-state";
import {
  createWindowAction,
  deactivateWindowAction,
  deleteWindowAction,
  updateWindowCapacityAction,
} from "../actions";
import { DAY_NAMES, formatCount, formatDuration, formatTimeRange, WEEK_ORDER } from "../format";
import { capacitySchema, LIMITS, windowSchema } from "../schemas";
import { sectionHref } from "../sections";
import { Badge, EmptyState, FieldGroup, SelectField, TextField } from "../ui/controls";
import { ItemActionForm, SaveBar, useSettingsForm } from "../ui/settings-form";
import { useTimedAnnouncement } from "../ui/use-timed-announcement";
import { WeeklyCalendar } from "./weekly-calendar";

export type ScheduleWindowItem = {
  id: string;
  offeringName: string;
  offeringActive: boolean;
  dayOfWeek: number;
  startMinute: number;
  durationMinutes: number;
  capacity: number;
  label: string | null;
  active: boolean;
  onCalendar: boolean;
  hasUpcomingBooking: boolean;
  maxUpcomingBooked: number;
};

export type ScheduleOfferingOption = {
  id: string;
  name: string;
  active: boolean;
};

const DAY_OPTIONS = WEEK_ORDER.map((day) => ({
  value: String(day),
  label: DAY_NAMES[day],
}));

export function ScheduleSection({
  windows,
  offerings,
  timezoneLabel,
  preferredOfferingId,
}: {
  windows: ScheduleWindowItem[];
  offerings: ScheduleOfferingOption[];
  timezoneLabel: string;
  preferredOfferingId?: string;
}) {
  const [addDay, setAddDay] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = windows.find((item) => item.id === selectedId);
  const [announcement, setAnnouncement] = useTimedAnnouncement();
  const opener = useRef<HTMLButtonElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  if (offerings.length === 0) {
    return (
      <EmptyState
        title="Add a trial class first"
        action={
          <Button asChild variant="outline">
            <Link href={sectionHref("offerings")}>Go to Trial Classes</Link>
          </Button>
        }
      >
        Every class time belongs to a trial class.
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 ref={heading} tabIndex={-1} className="font-semibold">
          Your recurring week
        </h3>
        <p className="text-sm text-muted-foreground">
          Choose a day to add a class, or select a class to manage it. Times repeat every week in{" "}
          {timezoneLabel}.
        </p>
      </div>

      {announcement ? (
        <p role="status" aria-live="polite" className="text-sm text-success">
          {announcement}
        </p>
      ) : null}

      <WeeklyCalendar
        windows={windows}
        onAdd={(button, day) => {
          opener.current = button;
          setAnnouncement(null);
          setAddDay(day);
        }}
        onSelect={(button, id) => {
          opener.current = button;
          setSelectedId(id);
        }}
      />

      <Dialog
        open={addDay !== null || !!selected}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setAddDay(null);
            setSelectedId(null);
          }
        }}
      >
        <DialogContent
          className="max-h-[90dvh] overflow-y-auto"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            (opener.current?.isConnected ? opener.current : heading.current)?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{selected?.offeringName ?? "Add a class time"}</DialogTitle>
            <DialogDescription>
              {selected
                ? `Every ${DAY_NAMES[selected.dayOfWeek]} · ${formatTimeRange(selected.startMinute, selected.durationMinutes)} · ${timezoneLabel}`
                : "Choose a trial class and the time it meets each week."}
            </DialogDescription>
          </DialogHeader>
          {selected && <WindowDetails item={selected} />}
          {addDay !== null ? (
            <WindowForm
              offerings={offerings}
              initialDay={addDay}
              preferredOfferingId={preferredOfferingId}
              timezoneLabel={timezoneLabel}
              onCancel={() => setAddDay(null)}
              onSuccess={(state) => {
                setAnnouncement(state.message);
                setAddDay(null);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WindowForm({
  offerings,
  initialDay,
  preferredOfferingId,
  timezoneLabel,
  onCancel,
  onSuccess,
}: {
  offerings: ScheduleOfferingOption[];
  initialDay: number;
  preferredOfferingId?: string;
  timezoneLabel: string;
  onCancel: () => void;
  onSuccess: (state: SettingsFormState) => void;
}) {
  const { state, onSubmit, pending, control, dirty } = useSettingsForm({
    action: createWindowAction,
    schema: windowSchema,
    initialValues: {
      trialOfferingId:
        (
          offerings.find((item) => item.id === preferredOfferingId) ??
          offerings.find((item) => item.active) ??
          offerings[0]
        )?.id ?? "",
      dayOfWeek: String(initialDay),
      startMinute: "18:00",
      durationMinutes: "60",
      capacity: "8",
      label: "",
    },
    onSuccess,
  });

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
      <FieldGroup>
        <SelectField
          label="Trial class"
          name="trialOfferingId"
          required
          control={control}
          options={offerings.map((offering) => ({
            value: offering.id,
            label: offering.active ? offering.name : `${offering.name} (not offered)`,
          }))}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="Day of the week"
            name="dayOfWeek"
            control={control}
            options={DAY_OPTIONS}
          />
          <TextField
            label="Start time"
            name="startMinute"
            type="time"
            control={control}
            helper={`Local time in ${timezoneLabel}.`}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Class length in minutes"
            name="durationMinutes"
            type="number"
            inputMode="numeric"
            min={LIMITS.durationMin}
            max={LIMITS.durationMax}
            step={5}
            control={control}
            helper={`Between ${LIMITS.durationMin} and ${LIMITS.durationMax} minutes.`}
          />
          <TextField
            label="Spots per class"
            name="capacity"
            type="number"
            inputMode="numeric"
            min={LIMITS.capacityMin}
            max={LIMITS.capacityMax}
            control={control}
          />
        </div>
        <TextField
          label="Internal label"
          name="label"
          maxLength={LIMITS.windowLabel}
          control={control}
          helper="Optional. Families do not see it."
          placeholder="Main mat with Coach Ana…"
        />
      </FieldGroup>

      <SaveBar
        saveLabel="Add Class Time"
        savingLabel="Adding…"
        pending={pending}
        dirty={dirty}
        onCancel={onCancel}
        state={state}
        idleHint="Repeats weekly until turned off."
      />
    </form>
  );
}

function WindowDetails({ item }: { item: ScheduleWindowItem }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {formatDuration(item.durationMinutes)}
          </span>
          {item.active && item.offeringActive ? (
            <Badge tone="active">Open</Badge>
          ) : (
            <Badge tone="muted">{item.active ? "Trial class not offered" : "Turned off"}</Badge>
          )}
          {item.hasUpcomingBooking ? <Badge tone="warning">Upcoming bookings</Badge> : null}
        </div>
        {item.label && <p className="text-sm text-pretty text-muted-foreground">{item.label}</p>}
        <p className="text-xs text-muted-foreground">
          {formatCount(item.capacity, "spot")} per class
          {item.maxUpcomingBooked > 0
            ? ` · ${formatCount(item.maxUpcomingBooked, "student")} booked in an upcoming class`
            : ""}
        </p>
      </div>

      <CapacityForm id={item.id} capacity={item.capacity} minimum={item.maxUpcomingBooked} />

      <div className="flex flex-wrap items-start gap-2">
        {item.active ? (
          <ItemActionForm
            action={deactivateWindowAction}
            id={item.id}
            label="Turn Off"
            pendingLabel="Turning off…"
            confirm={{
              title: "Turn off this class time?",
              body: (
                <>
                  Families will stop seeing it. Existing bookings stay, and it cannot be turned back
                  on from settings yet — add a new class time instead.
                </>
              ),
              confirmLabel: "Turn It Off",
            }}
          />
        ) : (
          <p className="text-xs text-pretty text-muted-foreground">
            Turned off. Reopening is not available yet — add a new class time with the same day and
            time.
          </p>
        )}

        {item.onCalendar ? (
          <p className="max-w-prose text-xs text-pretty text-muted-foreground">
            Individual dates have already been created for this class time, so it cannot be deleted.
          </p>
        ) : (
          <ItemActionForm
            action={deleteWindowAction}
            id={item.id}
            label="Delete"
            pendingLabel="Deleting…"
            variant="danger"
            confirm={{
              title: "Delete this class time?",
              body: (
                <>
                  It disappears from your weekly schedule. Nobody has booked it yet. This cannot be
                  undone.
                </>
              ),
              confirmLabel: "Delete Class Time",
            }}
          />
        )}
      </div>
    </div>
  );
}

function CapacityForm({
  id,
  capacity,
  minimum,
}: {
  id: string;
  capacity: number;
  minimum: number;
}) {
  const { state, onSubmit, pending, control, dirty, reset } = useSettingsForm({
    action: updateWindowCapacityAction,
    initialValues: { id, capacity: String(capacity) },
    schema: capacitySchema,
  });

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <UiFieldGroup className="w-full sm:max-w-40">
        <TextField
          label="Spots per class"
          name="capacity"
          type="number"
          inputMode="numeric"
          min={Math.max(LIMITS.capacityMin, minimum)}
          max={LIMITS.capacityMax}
          control={control}
          helper={
            minimum > 0
              ? `At least ${minimum} — that many students are already booked.`
              : `Between ${LIMITS.capacityMin} and ${LIMITS.capacityMax}.`
          }
        />
      </UiFieldGroup>
      <div className="flex flex-wrap items-center gap-2 pb-1">
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={pending || !dirty}
          aria-busy={pending || undefined}
        >
          {pending ? "Saving…" : "Update Spots"}
        </Button>
        {dirty && !pending ? (
          <Button type="button" variant="outline" size="sm" onClick={reset}>
            Discard
          </Button>
        ) : null}
        {state.status === "error" || (state.status === "success" && !dirty) ? (
          <p
            role="status"
            aria-live="polite"
            className={`text-xs text-pretty ${
              state.status === "error" ? "text-destructive" : "text-success"
            }`}
          >
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
