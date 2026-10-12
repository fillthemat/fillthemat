"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

const variants = [
  "A — Inline checklist",
  "B — One next step",
  "C — Split responsibilities",
];

// Throwaway shared UI. Preview builds deliberately omit the floating bar;
// shareable ?variant=A/B/C links and the prototype controls still work there.
export function PrototypeSwitcher() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const current = Math.max(
    0,
    ["A", "B", "C"].indexOf(params.get("variant") ?? "A"),
  );

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const cycle = (direction: number) => {
      const next = new URLSearchParams(params);
      next.set("variant", ["A", "B", "C"][(current + direction + 3) % 3]);
      router.replace(`${pathname}?${next}`, { scroll: false });
    };
    const onKey = (event: KeyboardEvent) => {
      if (
        (event.target as HTMLElement).closest(
          "input, textarea, select, [contenteditable], [role=alertdialog]",
        )
      )
        return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        cycle(event.key === "ArrowLeft" ? -1 : 1);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [current, params, pathname, router]);

  if (process.env.NODE_ENV === "production") return null;
  function cycle(direction: number) {
    const next = new URLSearchParams(params);
    next.set("variant", ["A", "B", "C"][(current + direction + 3) % 3]);
    router.replace(`${pathname}?${next}`, { scroll: false });
  }
  return (
    <div className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-popover p-2 shadow-lg">
      <Button
        variant="outline"
        size="icon"
        aria-label="Previous variant"
        onClick={() => cycle(-1)}
      >
        ←
      </Button>
      <span className="whitespace-nowrap text-xs">
        PROTOTYPE · {variants[current]}
      </span>
      <Button
        variant="outline"
        size="icon"
        aria-label="Next variant"
        onClick={() => cycle(1)}
      >
        →
      </Button>
    </div>
  );
}
