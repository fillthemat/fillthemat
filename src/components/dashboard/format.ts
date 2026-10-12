import { formatInTimeZone } from "date-fns-tz";
import type { Channel } from "@/lib/channel";

const CHANNEL_LABELS: Record<Channel, string> = {
  web: "Web",
  whatsapp: "WhatsApp",
  poppy: "Poppy",
};

export function formatChannel(channel: Channel): string {
  return CHANNEL_LABELS[channel];
}

const BOOKING_STATUS_LABELS: Record<string, string> = {
  booked: "Booked",
  showed: "Showed",
  no_show: "No-show",
  cancelled: "Cancelled",
};

const EMAIL_STATE_LABELS: Record<string, string> = {
  pending: "Pending",
  sent: "Sent",
  failed: "Failed",
  skipped: "Skipped",
};

export function formatBookingStatus(status: string): string {
  return BOOKING_STATUS_LABELS[status] ?? status;
}

export function formatEmailState(state: string | undefined): string {
  if (!state) return "—";
  return EMAIL_STATE_LABELS[state] ?? state;
}

export function formatBookingWhen(date: Date, timezone: string): string {
  return formatInTimeZone(date, timezone, "MMM d, yyyy, h:mm a");
}

export function formatOwnerDate(date: Date, timezone: string): string {
  return formatInTimeZone(date, timezone, "MMM d, yyyy");
}

export function formatOwnerDateTime(date: Date, timezone: string): string {
  return formatInTimeZone(date, timezone, "MMM d, yyyy, h:mm a");
}

export function bookingStatusVariant(
  status: string,
): "outline" | "success" | "warning" | "muted" {
  if (status === "showed") return "success";
  if (status === "no_show") return "warning";
  if (status === "cancelled") return "muted";
  return "outline";
}
