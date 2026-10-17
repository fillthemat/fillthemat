"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useDirtyState } from "./dirty-context";
import { cancelEditorAction, type EditorTarget, nextEditorAction } from "./editor-target";

export type { EditorTarget } from "./editor-target";

/**
 * One create/edit panel per category. Switching records (or opening Add)
 * while the open panel is dirty asks before discarding. A pending save
 * blocks the switch entirely so the in-flight editor stays mounted.
 */
export function useRecordEditor(category: string) {
  const { dirtyKeys } = useDirtyState();
  const [open, setOpen] = useState<EditorTarget>({ type: "closed" });
  const [pendingTarget, setPendingTarget] = useState<EditorTarget | null>(null);
  const [saving, setSaving] = useState(false);
  const categoryDirty = dirtyKeys.some((key) => key.startsWith(`${category}:`));

  const apply = useCallback((target: EditorTarget) => {
    setOpen(target);
    setPendingTarget(null);
  }, []);

  const requestOpen = useCallback(
    (target: EditorTarget) => {
      // Server actions are not abortable. Never unmount (or even prompt to
      // discard) while a save is in flight — the mutation would still land.
      if (saving) return;
      const action = nextEditorAction(open, target, {
        dirty: categoryDirty,
        saving: false,
      });
      if (action === "noop") return;
      if (action === "confirm") {
        setPendingTarget(target);
        return;
      }
      apply(target);
    },
    [apply, categoryDirty, open, saving],
  );

  const closeImmediate = useCallback(() => {
    apply({ type: "closed" });
  }, [apply]);

  /** Idle Cancel closes immediately and never reads dirtyKeys. */
  const requestCancel = useCallback(
    (formDirty: boolean) => {
      const action = cancelEditorAction(formDirty, saving);
      if (action === "noop") return;
      if (action === "confirm") {
        setPendingTarget({ type: "closed" });
        return;
      }
      apply({ type: "closed" });
    },
    [apply, saving],
  );

  const keepEditing = useCallback(() => {
    setPendingTarget(null);
  }, []);

  const discardAndSwitch = useCallback(() => {
    if (saving) {
      setPendingTarget(null);
      return;
    }
    if (pendingTarget) apply(pendingTarget);
  }, [apply, pendingTarget, saving]);

  const isEditing = (id: string) => open.type === "edit" && open.id === id;
  const isCreating = open.type === "create";

  return {
    open,
    pendingTarget,
    saving,
    setSaving,
    requestOpen,
    requestCancel,
    closeImmediate,
    keepEditing,
    discardAndSwitch,
    isEditing,
    isCreating,
  };
}

export function DiscardEditsDialog({
  open,
  title = "Discard unsaved changes?",
  description = "You have changes that have not been saved yet. If you continue, those edits are lost.",
  onKeepEditing,
  onDiscard,
}: {
  open: boolean;
  title?: string;
  description?: string;
  onKeepEditing: () => void;
  onDiscard: () => void;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onKeepEditing();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep Editing</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onDiscard}>
            Discard Changes
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const ANNOUNCEMENT_MS = 8000;

/** Success copy lives outside the editor so it survives close, then clears. */
export function useTimedAnnouncement() {
  const [announcement, setAnnouncement] = useState<string | null>(null);

  useEffect(() => {
    if (!announcement) return;
    const timer = window.setTimeout(() => setAnnouncement(null), ANNOUNCEMENT_MS);
    return () => window.clearTimeout(timer);
  }, [announcement]);

  return [announcement, setAnnouncement] as const;
}
