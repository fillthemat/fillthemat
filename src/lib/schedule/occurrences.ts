import { addDays, addMinutes } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { MIN_LEAD_MINUTES, SLOT_HORIZON_DAYS } from "./constants";
import { encodeSlotId } from "./slot-id";

export type SlotWindow = {
  id: string;
  trialOfferingId: string;
  dayOfWeek: number;
  startMinute: number;
  durationMinutes: number;
  capacity: number;
  active: boolean;
  label: string | null;
};

export type SlotOccurrence = {
  trialWindowId: string;
  startAt: Date;
  capacity: number;
  bookedCount: number;
};

export type OpenSlot = {
  slotId: string;
  windowId: string;
  offeringId: string;
  startAt: Date;
  endAt: Date;
  capacity: number;
  bookedCount: number;
  remaining: number;
  label: string | null;
  localDateLabel: string;
  localTimeLabel: string;
  timezone: string;
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function localDateString(now: Date, timezone: string, dayOffset: number): string {
  const today = formatInTimeZone(now, timezone, "yyyy-MM-dd");
  const [year, month, day] = today.split("-").map(Number);
  const shifted = addDays(new Date(Date.UTC(year, month - 1, day)), dayOffset);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

function localWeekday(dateStr: string, timezone: string): number {
  const utcNoon = fromZonedTime(`${dateStr}T12:00:00`, timezone);
  return Number(formatInTimeZone(utcNoon, timezone, "i")) % 7;
}

function wallTimeToUtc(dateStr: string, startMinute: number, timezone: string): Date | null {
  const hours = Math.floor(startMinute / 60);
  const minutes = startMinute % 60;
  const wall = `${dateStr}T${pad(hours)}:${pad(minutes)}:00`;
  const utc = fromZonedTime(wall, timezone);
  const roundTrip = formatInTimeZone(utc, timezone, "yyyy-MM-dd'T'HH:mm");
  if (roundTrip !== `${dateStr}T${pad(hours)}:${pad(minutes)}`) {
    return null;
  }
  return utc;
}

export function listOpenSlots({
  offeringId,
  timezone,
  windows,
  occurrences,
  now,
  horizonDays = SLOT_HORIZON_DAYS,
  minLeadMinutes = MIN_LEAD_MINUTES,
}: {
  offeringId: string;
  timezone: string;
  windows: SlotWindow[];
  occurrences: SlotOccurrence[];
  now: Date;
  horizonDays?: number;
  minLeadMinutes?: number;
}): OpenSlot[] {
  const earliest = addMinutes(now, minLeadMinutes);
  const horizonEnd = addDays(now, horizonDays);
  const occurrenceByKey = new Map(
    occurrences.map((occurrence) => [
      `${occurrence.trialWindowId}|${occurrence.startAt.toISOString()}`,
      occurrence,
    ]),
  );

  const slots: OpenSlot[] = [];

  for (const window of windows) {
    if (!window.active || window.trialOfferingId !== offeringId) continue;

    for (let offset = 0; offset <= horizonDays + 1; offset += 1) {
      const dateStr = localDateString(now, timezone, offset);
      if (localWeekday(dateStr, timezone) !== window.dayOfWeek) continue;

      const startAt = wallTimeToUtc(dateStr, window.startMinute, timezone);
      if (!startAt) continue;
      if (startAt < earliest || startAt > horizonEnd) continue;

      const endAt = addMinutes(startAt, window.durationMinutes);
      const existing = occurrenceByKey.get(`${window.id}|${startAt.toISOString()}`);
      const capacity = existing?.capacity ?? window.capacity;
      const bookedCount = existing?.bookedCount ?? 0;
      if (bookedCount >= capacity) continue;

      slots.push({
        slotId: encodeSlotId(window.id, startAt),
        windowId: window.id,
        offeringId: window.trialOfferingId,
        startAt,
        endAt,
        capacity,
        bookedCount,
        remaining: capacity - bookedCount,
        label: window.label,
        localDateLabel: formatInTimeZone(startAt, timezone, "EEEE, MMMM d"),
        localTimeLabel: formatInTimeZone(startAt, timezone, "h:mm a"),
        timezone,
      });
    }
  }

  return slots.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

export function isAgeEligible(
  age: number,
  offering: { minimumAge: number | null; maximumAge: number | null },
): boolean {
  if (!Number.isInteger(age) || age < 0 || age > 99) return false;
  if (offering.minimumAge != null && age < offering.minimumAge) return false;
  if (offering.maximumAge != null && age > offering.maximumAge) return false;
  return true;
}
