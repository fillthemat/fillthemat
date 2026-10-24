"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { sectionHref, type SectionId, SECTIONS } from "./sections";
import { DirtyProvider, useDirtyState } from "./ui/dirty-context";

export function SettingsShell({
  activeSection,
  children,
}: {
  activeSection: SectionId;
  children: React.ReactNode;
}) {
  return (
    <DirtyProvider>
      <DirtyNavigationGuard>
        <div className="flex flex-col gap-5 lg:flex-row lg:gap-8">
          <SettingsNav active={activeSection} />
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </DirtyNavigationGuard>
    </DirtyProvider>
  );
}

/**
 * Intercepts same-origin left-clicks that would leave the current settings
 * view (category links, in-content links, and dashboard nav).
 *
 * Browser Back/Forward is not intercepted. Next.js App Router has no
 * `router.beforePopState` (that existed only in the Pages Router). `popstate`
 * fires after the router has already applied the history entry, so a confirm
 * dialog cannot restore the unsaved form. `beforeunload` still covers reload,
 * tab close, and cross-origin leaves.
 */
function DirtyNavigationGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { dirtyKeys } = useDirtyState();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const hasUnsaved = dirtyKeys.length > 0;

  useEffect(() => {
    if (!hasUnsaved) return;

    const onClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        event.button !== 0
      ) {
        return;
      }
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:")) return;

      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) {
        return;
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") return;

      event.preventDefault();
      event.stopPropagation();
      setPendingHref(`${url.pathname}${url.search}${url.hash}`);
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [hasUnsaved]);

  return (
    <>
      {children}
      <AlertDialog
        open={pendingHref !== null}
        onOpenChange={(open) => {
          if (!open) setPendingHref(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
            <AlertDialogDescription>
              You have changes that have not been saved yet. If you leave now, those edits are lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Editing</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (pendingHref) router.push(pendingHref);
                setPendingHref(null);
              }}
            >
              Discard Changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function SettingsNav({ active }: { active: SectionId }) {
  const { dirtyKeys } = useDirtyState();
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const list = listRef.current;
    const current = list?.querySelector<HTMLElement>("a[aria-current='page']");
    if (!list || !current || list.scrollWidth <= list.clientWidth) return;
    list.scrollLeft = current.offsetLeft - (list.clientWidth - current.clientWidth) / 2;
  }, []);

  return (
    <nav aria-label="Settings categories" className="lg:w-44 lg:shrink-0 lg:self-start">
      <ul
        ref={listRef}
        className="-mx-1 flex gap-1 overflow-x-auto overscroll-x-contain px-1 pb-1 lg:mx-0 lg:flex-col lg:overflow-x-visible lg:px-0 lg:pb-0"
      >
        {SECTIONS.map((section) => {
          const isActive = section.id === active;
          const href = sectionHref(section.id);
          const dirtyHere = isActive && dirtyKeys.some((key) => key.startsWith(section.id));
          return (
            <li key={section.id} className="shrink-0 lg:shrink">
              <Button
                asChild
                variant={isActive ? "secondary" : "ghost"}
                className="w-full justify-start"
              >
                <Link href={href} aria-current={isActive ? "page" : undefined}>
                  <span className="flex items-center gap-2 whitespace-nowrap">
                    {section.label}
                    {dirtyHere ? <Badge variant="warning">Unsaved changes</Badge> : null}
                  </span>
                </Link>
              </Button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
