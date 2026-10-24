"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { sectionHref, type SectionId, SECTIONS } from "./sections";

export function SettingsShell({
  activeSection,
  children,
}: {
  activeSection: SectionId;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:gap-8">
      <SettingsNav active={activeSection} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function SettingsNav({ active }: { active: SectionId }) {
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
        {SECTIONS.map((section) => (
          <li key={section.id} className="shrink-0 lg:shrink">
            <Button
              asChild
              variant={section.id === active ? "secondary" : "ghost"}
              className="w-full justify-start"
            >
              <Link
                href={sectionHref(section.id)}
                aria-current={section.id === active ? "page" : undefined}
              >
                <span className="whitespace-nowrap">{section.label}</span>
              </Link>
            </Button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
