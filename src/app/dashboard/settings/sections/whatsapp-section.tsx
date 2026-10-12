"use client";

import Link from "next/link";
import {
  startTransition,
  useActionState,
  useState,
  useTransition,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { WhatsAppConnectionState } from "@/db/schema";
import type { EligibilityGap } from "@/lib/whatsapp/connection";
import { isBroken } from "@/lib/whatsapp/health";
import {
  COOLING_OFF_DAYS,
  DAY_MS,
  SIGNUP_RESERVATION_DAYS,
  canSwitchOff as stateCanSwitchOff,
} from "@/lib/whatsapp/lifecycle";
import { whatsappShareLink } from "@/lib/whatsapp/sharing";
import { IDLE_STATE } from "../form-state";
import { Callout } from "../ui/controls";
import {
  checkWhatsAppReadinessAction,
  enableWhatsAppAction,
} from "../whatsapp-actions";
import type { WhatsAppSettingsView } from "../whatsapp-view";
import { WhatsAppBroken } from "./whatsapp-broken";
import { WhatsAppSharing } from "./whatsapp-sharing";
import { type EmbeddedSignupConfig, WhatsAppSignup } from "./whatsapp-signup";
import { releaseDateLabel, WhatsAppSwitchOff } from "./whatsapp-switch-off";

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
  qrDataUrl,
}: {
  connection: WhatsAppSettingsView;
  signupConfig: EmbeddedSignupConfig | null;
  qrDataUrl: string | null;
}) {
  const [result, formAction, pending] = useActionState(
    enableWhatsAppAction,
    IDLE_STATE,
  );
  const [checking, checkTransition] = useTransition();
  const [readinessMessage, setReadinessMessage] = useState("");
  const [confirmReleaseAt, setConfirmReleaseAt] = useState<Date | null>(null);
  const state = pending ? "buying" : connection.state;
  const eligible = connection.gaps.length === 0;
  const canEnable = ["off", "failed", "released", "cooling"].includes(
    connection.state,
  );
  const canSwitchOff = stateCanSwitchOff(connection.state);
  const enabled = pending || !["off", "cooling", "released"].includes(state);
  const signedUp =
    ["needs-card", "live", "cooling"].includes(state) || isBroken(state);
  const shareLink = whatsappShareLink(connection);

  return (
    <div className="flex flex-col gap-5">
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
          disabled={
            pending ||
            checking ||
            (!canEnable && !canSwitchOff) ||
            (!eligible && !canSwitchOff)
          }
          onCheckedChange={(checked) => {
            if (checked) startTransition(formAction);
            else
              setConfirmReleaseAt(
                new Date(Date.now() + COOLING_OFF_DAYS * DAY_MS),
              );
          }}
        />
      </div>
      <WhatsAppSwitchOff
        releaseAt={confirmReleaseAt}
        onClose={() => setConfirmReleaseAt(null)}
      />
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
        <Badge
          variant={state === "failed" || isBroken(state) ? "warning" : "muted"}
        >
          {labels[state]}
        </Badge>
        {connection.number ? (
          <p className="text-sm">
            {state === "live" ? "WhatsApp number" : "Reserved number"}:{" "}
            <strong>{connection.number}</strong>
          </p>
        ) : null}
        {state === "off" ? (
          <p className="text-sm text-muted-foreground">
            Switch on when you’re ready. Have your personal Facebook login and a
            school payment card handy.
          </p>
        ) : null}
        {state === "cooling" && connection.releaseAt ? (
          <Callout title="WhatsApp is switched off">
            Your number will be released on{" "}
            {releaseDateLabel(connection.releaseAt)} (UTC). Switch back on
            before then to keep it. Prospects get only your school phone and
            public contact email. Old links and QR codes stop working after
            release.
          </Callout>
        ) : null}
        {state === "released" ? (
          <Callout title="Your old number has been released">
            Old links and QR codes no longer work. Switch on to buy a new number
            and repeat Meta signup. Past conversations stay with your school.
          </Callout>
        ) : null}
        <WhatsAppBroken connection={connection} pending={pending} />
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
        {["popup", "cancelled", "popup-failed"].includes(state) &&
        connection.releaseAt ? (
          <p className="text-sm">
            Unfinished signup keeps your number for {SIGNUP_RESERVATION_DAYS}{" "}
            days. Resume before {releaseDateLabel(connection.releaseAt)} (UTC),
            or it will be released.
          </p>
        ) : null}
        {state === "needs-card" ? (
          <>
            <Callout title="Add your school’s payment card">
              WhatsApp is switched on but not Live. Meta bills your school
              directly for messages; Fillthemat pays for your number. Add a card
              in WhatsApp Manager: in Overview, choose Add payment method. Then
              check readiness here.
            </Callout>
            <a
              href={connection.managerUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm underline"
            >
              Add payment card in WhatsApp Manager
            </a>
            <Button
              type="button"
              disabled={checking}
              onClick={() =>
                checkTransition(async () => {
                  try {
                    setReadinessMessage(
                      (await checkWhatsAppReadinessAction()).message ?? "",
                    );
                  } catch {
                    setReadinessMessage(
                      "We could not check readiness. Reload settings and try again.",
                    );
                  }
                })
              }
            >
              {checking ? "Checking Meta…" : "Check readiness"}
            </Button>
          </>
        ) : null}
        {shareLink && qrDataUrl ? (
          <WhatsAppSharing
            link={shareLink}
            qrDataUrl={qrDataUrl}
            profileName={connection.profileName}
          />
        ) : null}
        {readinessMessage ? (
          <p role="status" className="text-sm">
            {readinessMessage}
          </p>
        ) : null}
        {[
          "popup",
          "cancelled",
          "popup-failed",
          "registering",
          "broken-access",
        ].includes(state) ? (
          <WhatsAppSignup connection={connection} config={signupConfig} />
        ) : null}
        {state === "failed" ? (
          <>
            <Callout tone="warning" title="Setup failed">
              We could not buy your number. WhatsApp is not Live; your Assistant
              still works on the web.
            </Callout>
            <Button
              type="button"
              disabled={!eligible || pending}
              onClick={() => startTransition(formAction)}
            >
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
    </div>
  );
}
