import type { WhatsAppConnectionState } from "@/db/schema";

export const COOLING_OFF_DAYS = 30;
export const SIGNUP_RESERVATION_DAYS = 7;
export const DAY_MS = 24 * 60 * 60_000;
export const RELEASE_LEASE_MS = 15 * 60_000;
export const RELEASE_BATCH_SIZE = 25;
export const RELEASE_SWEEP_BUDGET_MS = 4 * 60_000;

export const switchedOnStates = [
  "popup",
  "cancelled",
  "popup-failed",
  "failed",
  "needs-card",
  "registering",
  "live",
  "broken-card",
  "broken-access",
  "broken-restricted",
  "broken-number",
] as const;

export function canSwitchOff(state: WhatsAppConnectionState) {
  return switchedOnStates.some((candidate) => candidate === state);
}
