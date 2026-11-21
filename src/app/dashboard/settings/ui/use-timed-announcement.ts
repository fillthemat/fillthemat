"use client";

import { useEffect, useState } from "react";

/** Success copy survives closing the editor, then clears. */
export function useTimedAnnouncement() {
  const [announcement, setAnnouncement] = useState<string | null>(null);
  useEffect(() => {
    if (!announcement) return;
    const timer = window.setTimeout(() => setAnnouncement(null), 8000);
    return () => window.clearTimeout(timer);
  }, [announcement]);
  return [announcement, setAnnouncement] as const;
}
