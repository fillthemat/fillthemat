/** Pure helpers for settings form lifecycle. Kept out of client modules so tests can import them. */

export type FormValues = Record<string, string>;

export function sameValues(a: FormValues, b: FormValues): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => a[key] === b[key]);
}

/**
 * After a confirmed save, copy server-normalized values into the form except
 * for fields the owner typed while the request was in flight.
 */
export function applySavedValues<T extends FormValues>(
  previous: T,
  saved: FormValues,
  typedDuringSave: readonly string[],
): T {
  const updates: FormValues = {};
  for (const [field, value] of Object.entries(saved)) {
    if (!typedDuringSave.includes(field)) updates[field] = value;
  }
  return { ...previous, ...updates };
}

/**
 * After a confirmed create, reset to the blank form but keep characters typed
 * after submit. Those leftover fields are unsaved relative to the new blank
 * baseline.
 */
export function applyCreateSuccessValues<T extends FormValues>(
  previous: T,
  blank: T,
  typedDuringSave: readonly string[],
): T {
  const updates: FormValues = {};
  for (const field of typedDuringSave) {
    const value = previous[field];
    if (value !== undefined) updates[field] = value;
  }
  return { ...blank, ...updates };
}

export function nullToEmpty(value: string | number | null | undefined): string {
  if (value == null) return "";
  return String(value);
}

export function serializeTimestamp(value: Date | string): string {
  if (typeof value === "string") return value;
  return value.toISOString();
}
