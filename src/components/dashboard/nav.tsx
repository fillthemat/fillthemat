"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/dashboard", label: "Overview", match: "exact" as const },
  { href: "/dashboard/bookings", label: "Bookings", match: "prefix" as const },
  { href: "/dashboard/leads", label: "Leads", match: "prefix" as const },
  { href: "/dashboard/settings", label: "Settings", match: "prefix" as const },
];

function isActive(pathname: string, href: string, match: "exact" | "prefix") {
  if (match === "exact") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DashboardNav({ schoolName }: { schoolName: string }) {
  const pathname = usePathname();

  return (
    <header className="border-b border-border md:flex md:min-h-dvh md:w-52 md:shrink-0 md:flex-col md:self-stretch md:border-r md:border-b-0">
      <p className="truncate px-4 py-3 text-sm font-medium md:px-4 md:pt-5 md:pb-3">{schoolName}</p>
      <nav aria-label="Dashboard" className="px-2 pb-2 md:px-3 md:pb-4">
        <ul className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
          {LINKS.map((link) => {
            const current = isActive(pathname, link.href, link.match);
            return (
              <li key={link.href} className="shrink-0">
                <Link
                  href={link.href}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "block rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/70",
                    current ? "bg-muted font-medium text-foreground" : "text-muted-foreground",
                  )}
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
