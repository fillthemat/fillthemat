export type ConversionDisplay = {
  /** Visible metric value: a percentage, or an em dash when undefined. */
  value: string;
  /** Scope / evidence line under the value. */
  evidence: string;
  defined: boolean;
};

/**
 * Booking conversion is converted / eligible, all time.
 * Zero eligible sessions is undefined (`—`), not 0%. A 0% figure is only shown
 * when there were eligible sessions and none converted. Values above 100% are
 * not clamped — that would hide a broken calculation.
 */
export function formatBookingConversion(
  convertedSessions: number,
  eligibleSessions: number,
): ConversionDisplay {
  if (eligibleSessions <= 0) {
    return {
      value: "—",
      evidence: "No eligible sessions yet",
      defined: false,
    };
  }
  const rate = (convertedSessions / eligibleSessions) * 100;
  const rounded = Math.round(rate * 10) / 10;
  const display = Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
  return {
    value: display,
    evidence: `${convertedSessions} of ${eligibleSessions} eligible sessions · All time`,
    defined: true,
  };
}

export function formatCountLabel(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}
