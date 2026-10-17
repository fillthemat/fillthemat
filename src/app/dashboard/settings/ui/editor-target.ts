export type EditorTarget = { type: "closed" } | { type: "create" } | { type: "edit"; id: string };

export function sameTarget(a: EditorTarget, b: EditorTarget): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "edit" && b.type === "edit") return a.id === b.id;
  return true;
}

/**
 * Switching while a save is in flight would unmount the editor and drop the
 * action result (the mutation still lands). Keep the saving editor mounted.
 */
export function nextEditorAction(
  current: EditorTarget,
  requested: EditorTarget,
  { dirty, saving }: { dirty: boolean; saving: boolean },
): "noop" | "apply" | "confirm" {
  if (sameTarget(current, requested)) return "noop";
  if (saving) return "noop";
  if (dirty) return "confirm";
  return "apply";
}

/** Idle Cancel must not consult category dirtyKeys. */
export function cancelEditorAction(
  formDirty: boolean,
  saving: boolean,
): "noop" | "confirm" | "close" {
  if (saving) return "noop";
  if (formDirty) return "confirm";
  return "close";
}
