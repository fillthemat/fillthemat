/**
 * Shared result shape for every settings server action.
 *
 * Actions never throw for expected problems: they return a state the form can
 * render as inline validation, a server error, or a success confirmation.
 */
export type SettingsFormState = {
  status: "idle" | "success" | "error";
  /** Human sentence shown in the section status area. */
  message: string | null;
  /** Field name -> first problem with that field. */
  fieldErrors: Record<string, string>;
  /**
   * Normalized values that were saved. Forms use this to reset their
   * default values and clear the form's dirty state.
   */
  values: Record<string, string> | null;
};

export const IDLE_STATE: SettingsFormState = {
  status: "idle",
  message: null,
  fieldErrors: {},
  values: null,
};

export function successState(message: string, values?: Record<string, string>): SettingsFormState {
  return {
    status: "success",
    message,
    fieldErrors: {},
    values: values ?? null,
  };
}

export function errorState(
  message: string,
  fieldErrors: Record<string, string> = {},
): SettingsFormState {
  return { status: "error", message, fieldErrors, values: null };
}

export const GENERIC_SERVER_ERROR =
  "We could not save that. Nothing changed — try again in a moment.";
