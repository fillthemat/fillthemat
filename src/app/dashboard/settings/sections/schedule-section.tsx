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
}: {
  windows: ScheduleWindowItem[];
  offerings: ScheduleOfferingOption[];
  timezoneLabel: string;
}) {
  const [adding, setAdding] = useState(false);
  const [announcement, setAnnouncement] = useTimedAnnouncement();
  const opener = useRef<HTMLButtonElement | null>(null);
  const activeCount = windows.filter((item) => item.active).length;

  const openAdd = (button: HTMLButtonElement) => {
    opener.current = button;
    setAnnouncement(null);
    setAdding(true);
  };

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
      <p className="text-sm text-muted-foreground">Times are in {timezoneLabel}.</p>

      {announcement ? (
        <p role="status" aria-live="polite" className="text-sm text-success">
          {announcement}
        </p>
      ) : null}

      <section className="flex flex-col gap-4" aria-labelledby="schedule-list">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="schedule-list" className="text-sm font-semibold">
            Weekly class times
          </h3>
          <p className="text-xs text-muted-foreground">
            {windows.length === 0
              ? "None yet"
              : `${formatCount(windows.length, "class time")} · ${activeCount} open to families`}
          </p>
        </div>

        {windows.length === 0 ? (
          <EmptyState
            title="No class times yet"
            action={
              <Button
                type="button"
                variant="outline"
                onClick={(event) => openAdd(event.currentTarget)}
              >
                Add a Class Time
              </Button>
            }
          >
            Add the weekly times a family can try a class.
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-5">
            {WEEK_ORDER.filter((day) => windows.some((item) => item.dayOfWeek === day)).map(
              (day) => (
                <section key={day} className="flex flex-col gap-1">
                  <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {DAY_NAMES[day]}
                  </h4>
                  <ul className="divide-y divide-border border-y border-border">
                    {windows
                      .filter((item) => item.dayOfWeek === day)
                      .map((item) => (
                        <WindowRow key={item.id} item={item} />
                      ))}
                  </ul>
                </section>
              ),
            )}
          </div>
        )}
      </section>

      {windows.length > 0 ? (
        <div>
          <Button type="button" variant="outline" onClick={(event) => openAdd(event.currentTarget)}>
            Add a Class Time
          </Button>
        </div>
      ) : null}

      <Dialog
        open={adding}
        onOpenChange={(isOpen) => {
          if (!isOpen) setAdding(false);
        }}
      >
        <DialogContent
          className="max-h-[90dvh] overflow-y-auto"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            opener.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Add a class time</DialogTitle>
            <DialogDescription>New class times become bookable right away.</DialogDescription>
          </DialogHeader>
          {adding ? (
            <WindowForm
              offerings={offerings}
              timezoneLabel={timezoneLabel}
              onCancel={() => setAdding(false)}
              onSuccess={(state) => {
                setAnnouncement(state.message);
                setAdding(false);
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
  timezoneLabel,
  onCancel,
  onSuccess,
}: {
  offerings: ScheduleOfferingOption[];
  timezoneLabel: string;
  onCancel: () => void;
  onSuccess: (state: SettingsFormState) => void;
}) {
  const { state, onSubmit, pending, control, dirty } = useSettingsForm({
    action: createWindowAction,
    schema: windowSchema,
    initialValues: {
      trialOfferingId: offerings[0]?.id ?? "",
      dayOfWeek: "1",
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
        idleHint="New class times become bookable right away."
      />
    </form>
  );
}

function WindowRow({ item }: { item: ScheduleWindowItem }) {
  return (
    <li className="flex flex-col gap-3 py-3">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium tabular-nums">
            {formatTimeRange(item.startMinute, item.durationMinutes)}
          </p>
          <span className="text-xs text-muted-foreground">
            {formatDuration(item.durationMinutes)}
          </span>
          {item.active ? <Badge tone="active">Open</Badge> : <Badge tone="muted">Turned off</Badge>}
          {item.hasUpcomingBooking ? <Badge tone="warning">Upcoming bookings</Badge> : null}
        </div>
        <p className="text-sm text-pretty text-muted-foreground">
          {item.offeringName}
          {item.offeringActive ? "" : " · trial class is not offered"}
          {item.label ? ` · ${item.label}` : ""}
        </p>
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
            Already on your calendar, so it cannot be deleted. Turn it off to stop offering it.
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
    </li>
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
