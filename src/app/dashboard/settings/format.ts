export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** Owners think of a week as starting on Monday. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

const TIME_FORMAT = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

/** Minutes after local midnight -> "6:00 PM". Wall-clock only, no timezone math. */
export function formatMinutes(minutes: number): string {
  const safe = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return TIME_FORMAT.format(Date.UTC(1970, 0, 1, 0, safe));
}

/** Minutes after local midnight -> "18:00" for `<input type="time">`. */
export function toTimeValue(minutes: number): string {
  const safe = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hour = Math.floor(safe / 60);
  return `${String(hour).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

export function formatTimeRange(startMinute: number, durationMinutes: number): string {
  return `${formatMinutes(startMinute)} – ${formatMinutes(startMinute + durationMinutes)}`;
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourLabel = `${hours} hr`;
  return rest === 0 ? hourLabel : `${hourLabel} ${rest} min`;
}

export function formatAgeRange(minimumAge: number | null, maximumAge: number | null): string {
  if (minimumAge != null && maximumAge != null) {
    return minimumAge === maximumAge ? `Age ${minimumAge}` : `Ages ${minimumAge}–${maximumAge}`;
  }
  if (minimumAge != null) return `Ages ${minimumAge} and up`;
  if (maximumAge != null) return `Ages ${maximumAge} and under`;
  return "All ages";
}

export function formatCount(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

/** "America/New_York" -> "America / New York" for readable helper copy. */
export function formatTimezone(timezone: string): string {
  return timezone.split("/").join(" / ").replace(/_/g, " ");
}
export function nullToEmpty(value: string | number | null | undefined): string {
  return value == null ? "" : String(value);
}

export function serializeTimestamp(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}
