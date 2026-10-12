"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "../ui/controls";
import { checkWhatsAppReadinessAction } from "../whatsapp-actions";
import type { WhatsAppSettingsView } from "../whatsapp-view";

const fixes = {
  "broken-card":
    "Your school’s payment card failed, was removed, or is not eligible. Fix billing in WhatsApp Manager, then check again.",
  "broken-access":
    "Fillthemat’s access was removed or expired. Reconnect with Meta below to authorize your school’s account again. Your number is kept.",
  "broken-restricted":
    "Meta restricted your school’s WhatsApp account. Resolve the restriction with Meta in WhatsApp Manager, then check again.",
  "broken-number":
    "Your WhatsApp number was deregistered or released. Start again with a new number. Old links and QR codes will stop working; replace them when your new number is Live.",
};

export function WhatsAppBroken({
  connection,
  pending,
}: {
  connection: WhatsAppSettingsView;
  pending: boolean;
}) {
  const [checking, transition] = useTransition();
  const [message, setMessage] = useState("");
  const state = connection.state;
  if (!(state in fixes)) return null;
  const fix = fixes[state as keyof typeof fixes];
  return (
    <>
      <Callout tone="warning" title="WhatsApp is broken">
        <p>{fix}</p>
        <p>
          The Assistant will not reply on WhatsApp until this is fixed. Your web
          Assistant still works.
        </p>
      </Callout>
      {state === "broken-card" || state === "broken-restricted" ? (
        <>
          <a
            href={connection.managerUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm underline"
          >
            {state === "broken-card"
              ? "Fix payment card in WhatsApp Manager"
              : "Resolve restriction with Meta"}
          </a>
          <Button
            type="button"
            disabled={checking}
            onClick={() =>
              transition(async () => {
                try {
                  setMessage(
                    (await checkWhatsAppReadinessAction()).message ?? "",
                  );
                } catch {
                  setMessage(
                    "We could not check Meta. Reload settings and try again.",
                  );
                }
              })
            }
          >
            {checking ? "Checking Meta…" : "Check connection again"}
          </Button>
        </>
      ) : null}
      {state === "broken-number" ? (
        <Button type="submit" disabled={pending || connection.gaps.length > 0}>
          Start again with a new number
        </Button>
      ) : null}
      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}
    </>
  );
}
