"use client";

import Link from "next/link";
import { useActionState, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { WhatsAppConnectionState } from "@/db/schema";
import type {
  EligibilityGap,
  WhatsAppConnectionView,
} from "@/lib/whatsapp/connection";
import { IDLE_STATE } from "../form-state";
import { Callout } from "../ui/controls";
import { enableWhatsAppAction } from "../whatsapp-actions";
import { type EmbeddedSignupConfig, WhatsAppSignup } from "./whatsapp-signup";

const eligibility: {
  gap: EligibilityGap;
  label: string;
  href: string;
  fix: string;
}[] = [
  {
    gap: "approval",
    label: "School approved",
    href: "/dashboard",
    fix: "Check approval status",
  },
  {
    gap: "publishing",
    label: "School page published",
    href: "/dashboard",
    fix: "Preview and publish",
  },
  {
    gap: "phone",
    label: "School phone set",
    href: "/dashboard/settings",
    fix: "Add school phone",
  },
  {
    gap: "public-contact-email",
    label: "Public contact email set",
    href: "/dashboard/settings",
    fix: "Add public contact email",
  },
];
const labels: Record<WhatsAppConnectionState, string> = {
  off: "Off",
  buying: "Buying a number",
  popup: "Awaiting Meta signup",
  cancelled: "Meta signup cancelled",
  "popup-failed": "Meta signup failed",
  failed: "Setup failed",
  "needs-card": "Setup succeeded · Needs card",
  registering: "Registering number",
  live: "Live · Working",
  cooling: "Off · Cooling-off",
  released: "Off · Number released",
  "broken-card": "Broken · Card",
  "broken-access": "Broken · Access",
  "broken-restricted": "Broken · Restricted",
  "broken-number": "Broken · Number",
};

export function WhatsAppSection({
  connection,
  signupConfig,
}: {
  connection: WhatsAppConnectionView;
  signupConfig: EmbeddedSignupConfig | null;
}) {
  const [result, formAction, pending] = useActionState(
    enableWhatsAppAction,
    IDLE_STATE,
  );
  const form = useRef<HTMLFormElement>(null);
  const state = pending ? "buying" : connection.state;
  const eligible = connection.gaps.length === 0;
  const canEnable = connection.state === "off" || connection.state === "failed";
  const enabled =
    pending ||
    ![
      "off",
      "failed",
      "cancelled",
      "popup-failed",
      "cooling",
      "released",
    ].includes(state);
  const signedUp = ["needs-card", "live", "cooling"].includes(state);

  return (
    <form ref={form} action={formAction} className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <Label htmlFor="enable-whatsapp">Enable WhatsApp</Label>
          <p className="mt-1 text-sm text-muted-foreground">
            Let prospects reach your school’s Assistant on WhatsApp.
          </p>
        </div>
        <Switch
          id="enable-whatsapp"
          checked={enabled}
          disabled={!eligible || pending || !canEnable}
          onCheckedChange={(checked) => {
            if (checked) form.current?.requestSubmit();
          }}
        />
      </div>
      <Callout
        title={eligible ? "Ready to set up" : "Before you can enable WhatsApp"}
        tone={eligible ? "neutral" : "warning"}
      >
        <ul className="flex flex-col gap-2">
          {eligibility.map(({ gap, label, href, fix }) => {
            const missing = connection.gaps.includes(gap);
            return (
              <li key={gap}>
                <span aria-hidden="true">{missing ? "○" : "✓"} </span>
                {label}
                {missing ? (
                  <>
                    {" "}
                    —{" "}
                    <Link href={href} className="underline">
                      {fix}
                    </Link>
                  </>
                ) : (
                  <span className="sr-only">: complete</span>
                )}
              </li>
            );
          })}
        </ul>
      </Callout>
      <Callout title="Your school owns its WhatsApp account">
        Fillthemat buys and pays for a new US number. Your existing number stays
        untouched. You authorize your school’s account in Meta’s one-time popup
        and add your school’s card in WhatsApp Manager to pay Meta’s message
        fees. The Assistant shares your school phone and public contact email
        when someone asks for a person; your notification email stays private.
      </Callout>
      <ol className="flex flex-col gap-3 border-l border-border pl-4">
        <li>
          <p className="text-sm font-semibold">
            1. New US number —{" "}
            {connection.number
              ? "Succeeded"
              : state === "failed"
                ? "Failed"
                : state === "buying"
                  ? "In progress"
                  : "Not started"}
          </p>
          <p className="text-xs text-muted-foreground">
            Fillthemat purchases it in the background.
          </p>
        </li>
        <li>
          <p className="text-sm font-semibold">
            2. One-time Meta signup —{" "}
            {signedUp
              ? "Complete"
              : state === "popup"
                ? "Next step"
                : "Not completed"}
          </p>
          <p className="text-xs text-muted-foreground">
            Facebook → business → school profile → new number → verification
            code → terms.
          </p>
        </li>
        <li>
          <p className="text-sm font-semibold">
            3. Number registration — {signedUp ? "Complete" : "Not completed"}
          </p>
          <p className="text-xs text-muted-foreground">
            Fillthemat registers your number with Meta.
          </p>
        </li>
        <li>
          <p className="text-sm font-semibold">
            4. School card in Meta —{" "}
            {state === "live" ? "Ready" : "Not confirmed"}
          </p>
          <p className="text-xs text-muted-foreground">
            Your school pays Meta directly. Live requires a registered number
            and a card on file.
          </p>
        </li>
      </ol>
      <div className="flex flex-col items-start gap-3" aria-live="polite">
        <Badge variant={state === "failed" ? "warning" : "muted"}>
          {labels[state]}
        </Badge>
        {connection.number ? (
          <p className="text-sm">
            Reserved number: <strong>{connection.number}</strong>
          </p>
        ) : null}
        {state === "off" ? (
          <p className="text-sm text-muted-foreground">
            Switch on when you’re ready. Have your personal Facebook login and a
            school payment card handy.
          </p>
        ) : null}
        {state === "buying" ? (
          <p className="text-sm">
            We are buying your number. WhatsApp is not Live yet. If this status
            persists, contact Fillthemat.
          </p>
        ) : null}
        {state === "popup" ? (
          <p className="text-sm">
            Your number is reserved for Meta signup. WhatsApp is not Live yet.
          </p>
        ) : null}
        {["popup", "cancelled", "popup-failed", "registering"].includes(
          state,
        ) ? (
          <WhatsAppSignup connection={connection} config={signupConfig} />
        ) : null}
        {state === "failed" ? (
          <>
            <Callout tone="warning" title="Setup failed">
              We could not buy your number. WhatsApp is off; your Assistant
              still works on the web.
            </Callout>
            <Button type="submit" disabled={!eligible || pending}>
              Try setup again
            </Button>
          </>
        ) : null}
        {result.message ? (
          <p
            role={result.status === "error" ? "alert" : "status"}
            className="text-sm"
          >
            {result.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
