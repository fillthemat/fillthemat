"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function DashboardError({ error, reset }: { error: unknown; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main id="main-content" className="flex max-w-lg flex-col gap-3">
      <h1 className="text-lg font-semibold">This page is unavailable</h1>
      <p className="text-sm leading-relaxed text-pretty text-muted-foreground">
        We could not load these numbers. Nothing here is a substitute for live counts — try again in
        a moment.
      </p>
      <Button type="button" variant="outline" className="self-start" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}
