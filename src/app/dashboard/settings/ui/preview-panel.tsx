"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "./controls";

/**
 * A visual preview of owner-facing settings. It shows how content is laid out
 * for families — it is not a test of what the agent will say.
 */
export function PreviewPanel({
  title,
  note,
  dirty,
  children,
}: {
  title: string;
  note: string;
  dirty: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();

  return (
    <aside className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          {title}
          {dirty ? <Badge tone="warning">Unsaved</Badge> : null}
        </h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="lg:hidden"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Hide Preview" : "Show Preview"}
        </Button>
      </div>
      <div id={bodyId} className={`flex-col gap-2 ${open ? "flex" : "hidden lg:flex"}`}>
        {children}
        <p className="text-xs leading-relaxed text-pretty text-muted-foreground">
          {dirty ? `Showing your unsaved edits. ${note}` : note}
        </p>
      </div>
    </aside>
  );
}
