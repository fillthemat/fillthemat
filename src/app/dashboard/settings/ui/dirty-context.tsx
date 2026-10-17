"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type DirtyContextValue = {
  setDirty: (key: string, dirty: boolean) => void;
  dirtyKeys: readonly string[];
};

const DirtyContext = createContext<DirtyContextValue>({
  setDirty: () => {},
  dirtyKeys: [],
});

/**
 * Tracks which settings forms hold unsaved edits so category navigation can
 * warn before the edits are thrown away.
 */
export function DirtyProvider({ children }: { children: React.ReactNode }) {
  const [dirtyKeys, setDirtyKeys] = useState<string[]>([]);

  const setDirty = useCallback((key: string, dirty: boolean) => {
    setDirtyKeys((previous) => {
      const has = previous.includes(key);
      if (dirty === has) return previous;
      return dirty ? [...previous, key] : previous.filter((k) => k !== key);
    });
  }, []);

  useEffect(() => {
    if (dirtyKeys.length === 0) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirtyKeys.length]);

  const value = useMemo(() => ({ setDirty, dirtyKeys }), [setDirty, dirtyKeys]);

  return <DirtyContext value={value}>{children}</DirtyContext>;
}

export function useDirtyState() {
  return useContext(DirtyContext);
}

/** Report this form's unsaved state to the shell. */
export function useDirtyRegistration(key: string, dirty: boolean) {
  const { setDirty } = useDirtyState();
  useEffect(() => {
    setDirty(key, dirty);
    return () => setDirty(key, false);
  }, [key, dirty, setDirty]);
}
