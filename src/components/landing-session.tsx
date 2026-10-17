"use client";

import { useEffect } from "react";
import { LANDING_SESSION_MINUTES } from "@/lib/schedule/constants";
import { randomToken } from "./browser-token";

const storageKey = (slug: string) => `fillthemat.session.${slug}`;

export function readLandingSessionToken(slug: string): string | null {
  const raw = window.localStorage.getItem(storageKey(slug));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { token?: string; exp?: number };
    if (!parsed.token || !parsed.exp || parsed.exp < Date.now()) return null;
    return parsed.token;
  } catch {
    return null;
  }
}

export function LandingSession({ slug, preview }: { slug: string; preview: boolean }) {
  useEffect(() => {
    const existing = readLandingSessionToken(slug);
    const token = existing ?? randomToken();
    const exp = Date.now() + LANDING_SESSION_MINUTES * 60 * 1000;
    window.localStorage.setItem(storageKey(slug), JSON.stringify({ token, exp }));
    const params = new URLSearchParams(window.location.search);
    void fetch("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slug,
        token,
        preview,
        utm: {
          utm_source: params.get("utm_source") ?? undefined,
          utm_medium: params.get("utm_medium") ?? undefined,
          utm_campaign: params.get("utm_campaign") ?? undefined,
          utm_content: params.get("utm_content") ?? undefined,
          utm_term: params.get("utm_term") ?? undefined,
        },
      }),
    });
  }, [slug, preview]);

  return null;
}
