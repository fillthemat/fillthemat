"use client";

import { type CSSProperties, useState } from "react";

const DEFAULT_WELCOME =
  "Hi! I can answer questions about our classes and help you book a free trial.";

/**
 * Representative rendering of the page families see. It shows layout and
 * content, not agent behavior.
 */
export function PublicPagePreview({
  schoolName,
  location,
  logoUrl,
  accentColor,
  welcomeMessage,
  showBranding = true,
}: {
  schoolName: string;
  location: string | null;
  logoUrl?: string;
  accentColor?: string;
  welcomeMessage: string;
  showBranding?: boolean;
}) {
  const [logoFailed, setLogoFailed] = useState(false);
  const accent = /^#[0-9A-Fa-f]{6}$/.test(accentColor ?? "")
    ? (accentColor as string)
    : "var(--color-page-accent-default)";
  const validLogo = showBranding && logoUrl?.startsWith("https://") && !logoFailed ? logoUrl : null;

  return (
    <div className="overflow-hidden rounded-2xl border border-page-800 bg-white text-page-950">
      <div className="flex flex-col gap-4 p-5">
        {showBranding ? (
          validLogo ? (
            <img
              src={validLogo}
              alt={`${schoolName} logo`}
              width={120}
              height={40}
              loading="lazy"
              onError={() => setLogoFailed(true)}
              className="h-10 w-auto max-w-preview-logo object-contain object-left"
            />
          ) : (
            <div className="flex h-10 items-center rounded-md border border-dashed border-page-300 px-3 text-xs text-page-500">
              {logoUrl && logoFailed ? "That image did not load" : "No logo yet"}
            </div>
          )
        ) : null}

        <div className="min-w-0">
          <p className="truncate text-lg font-semibold tracking-tight">{schoolName}</p>
          {location ? <p className="truncate text-sm text-page-600">{location}</p> : null}
        </div>

        <div className="rounded-2xl bg-page-100 px-4 py-3 text-sm leading-relaxed text-page-800">
          <p className="line-clamp-6 break-words whitespace-pre-wrap">
            {welcomeMessage.trim() || DEFAULT_WELCOME}
          </p>
        </div>

        <div
          className="flex h-10 items-center justify-center rounded-full bg-(--accent) px-4 text-sm font-medium text-white"
          style={{ "--accent": accent } as CSSProperties}
        >
          Book a trial class
        </div>
      </div>
    </div>
  );
}
