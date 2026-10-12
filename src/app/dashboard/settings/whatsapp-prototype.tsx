"use client";

// Three throwaway settings-flow variants on ?section=whatsapp&variant=A/B/C.
// Question: checklist, one-next-step, or split responsibilities? All in-memory.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { PrototypeSwitcher } from "@/components/prototype-switcher";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PrototypeSwitch } from "@/components/ui/prototype-switch";
import { Callout, SelectField, TextField } from "./ui/controls";

const states = [
  "off",
  "buying",
  "popup",
  "cancelled",
  "popup-failed",
  "failed",
  "needs-card",
  "registering",
  "live",
  "cooling",
  "released",
  "broken-card",
  "broken-access",
  "broken-restricted",
  "broken-number",
] as const;
type State = (typeof states)[number];
type School = {
  name: string;
  slug: string;
  approved: boolean;
  published: boolean;
  phone: string;
  notificationEmail: string;
};
const stateLabels: Record<State, string> = {
  off: "Off / ready to enable",
  buying: "Buying a number (transient)",
  popup: "Meta popup",
  cancelled: "Popup cancelled",
  "popup-failed": "Popup blocked or failed",
  failed: "Provisioning failed",
  "needs-card": "Succeeded / missing card",
  registering: "Card present / number not registered",
  live: "Live / working",
  cooling: "Off / 30-day cooling-off",
  released: "Off / number released",
  "broken-card": "Broken / card",
  "broken-access": "Broken / access removed",
  "broken-restricted": "Broken / account restricted",
  "broken-number": "Broken / number released",
};
const popupSteps = [
  "Facebook login",
  "Choose or create business",
  "Profile name",
  "Enter the new number",
  "Verify with 6-digit code",
  "Accept terms",
];
const brokenCopy: Record<
  string,
  { part: string; action: string; body: string }
> = {
  "broken-card": {
    part: "Card / payment",
    action: "Update card in WhatsApp Manager ↗",
    body: "Meta cannot charge the School’s card. The Assistant is not working on WhatsApp.",
  },
  "broken-access": {
    part: "Fillthemat access removed",
    action: "Reconnect with Meta",
    body: "The School’s Meta account no longer gives Fillthemat access.",
  },
  "broken-restricted": {
    part: "Account restricted",
    action: "Review restriction in WhatsApp Manager ↗",
    body: "Meta has restricted the School’s account. Review the restriction in Meta before reconnecting.",
  },
  "broken-number": {
    part: "Number released",
    action: "Set up a new number",
    body: "The old number is no longer yours. Old links and QR codes must not be shared.",
  },
};

function parseState(value: string | null): State {
  return states.find((state) => state === value) ?? "off";
}

export function WhatsAppPrototype({
  school,
  demo = false,
}: {
  school: School;
  demo?: boolean;
}) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const variant = params.get("variant") ?? "A";
  const [state, setState] = useState<State>(() =>
    parseState(params.get("state")),
  );
  const stateRef = useRef(state);
  const [eligibility, setEligibility] = useState("school");
  const [phone, setPhone] = useState(school.phone);
  const [email, setEmail] = useState(demo ? "hello@example.com" : "");
  const [profile, setProfile] = useState(school.name);
  const [number, setNumber] = useState("+1 (202) 555-0142");
  const [popupStep, setPopupStep] = useState(0);
  const [enteredNumber, setEnteredNumber] = useState("");
  const [code, setCode] = useState("");
  const [business, setBusiness] = useState(school.name);
  const [managerOpen, setManagerOpen] = useState(false);
  const [managerSaved, setManagerSaved] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [resumeState, setResumeState] = useState<State>("live");
  const [copied, setCopied] = useState(false);
  const [approvedOverride, setApprovedOverride] = useState(false);
  const approved =
    eligibility !== "unapproved" && (school.approved || approvedOverride);
  const published =
    eligibility !== "unpublished" && (school.published || approvedOverride);
  const hasPhone = eligibility !== "no-phone" && phone.trim().length > 0;
  const hasEmail =
    eligibility !== "no-email" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const eligible = approved && published && hasPhone && hasEmail;
  const broken = state.startsWith("broken-");
  const live = state === "live" && eligible;
  const enabled = ![
    "off",
    "failed",
    "cancelled",
    "popup-failed",
    "cooling",
    "released",
  ].includes(state);
  const registered =
    ["needs-card", "live", "cooling"].includes(state) ||
    (broken && state !== "broken-number");
  const card = [
    "registering",
    "live",
    "cooling",
    "broken-access",
    "broken-restricted",
    "broken-number",
  ].includes(state);
  const hasNumber = ![
    "off",
    "failed",
    "released",
    "broken-number",
    "buying",
  ].includes(state);
  const waLink = `https://wa.me/${number.replace(/\D/g, "")}`;
  const provisioning =
    state === "failed" ? "failed" : hasNumber ? "succeeded" : "not attempted";

  function go(next: State) {
    stateRef.current = next;
    setState(next);
    const query = new URLSearchParams(params);
    query.set("state", next);
    router.replace(`${pathname}?${query}`, { scroll: false });
  }
  function openPopup() {
    setPopupStep(0);
    setCode("");
    setEnteredNumber("");
    go("popup");
  }
  function enable() {
    if (state === "cooling") {
      go(resumeState);
      return;
    }
    if (state === "released" || state === "broken-number")
      setNumber("+1 (202) 555-0143");
    go("buying");
    // Local-only delay stands in for background number purchase.
    window.setTimeout(() => {
      if (stateRef.current !== "buying") return;
      setPopupStep(0);
      go("popup");
    }, 800);
  }
  function openManager() {
    setManagerSaved(false);
    setManagerOpen(true);
  }

  const readiness = (
    <div className="flex flex-col gap-2 text-sm">
      <p className="font-medium">Live when both are ready</p>
      <p>{registered ? "✓" : "○"} Number registered</p>
      <p>{card ? "✓" : "○"} Card on file in WhatsApp Manager</p>
      <p className="text-xs text-muted-foreground">
        No template review wait. Opening Meta or visiting billing is not proof
        of readiness.
      </p>
    </div>
  );
  const contact = (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium">A direct way to reach a person</p>
      <p className="text-sm text-muted-foreground">
        When someone asks for a person, the Assistant shares this School phone
        and email — not the new WhatsApp number.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label="School phone"
          name="schoolPhone"
          type="tel"
          value={phone}
          onValueChange={setPhone}
          required
        />
        <TextField
          label="Public contact email"
          name="publicEmail"
          type="email"
          value={email}
          onValueChange={setEmail}
          required
          helper="Shared with prospects. Prototype proposal, not a settled field."
        />
      </div>
      <Button variant="link" onClick={() => setEmail(school.notificationEmail)}>
        Use notification email publicly: {school.notificationEmail}
      </Button>
      <p className="text-xs text-muted-foreground">
        Notification email stays private unless you explicitly choose to share
        it here. Nothing is saved in this prototype.
      </p>
    </div>
  );
  const preflight = (
    <Callout
      title={eligible ? "Ready to set up" : "Before you can enable WhatsApp"}
      tone={eligible ? "neutral" : "warning"}
    >
      <ul className="flex flex-col gap-1">
        <li>{approved ? "✓" : "○"} School approved</li>
        <li>{published ? "✓" : "○"} School page published</li>
        <li>{hasPhone ? "✓" : "○"} School phone set</li>
        <li>{hasEmail ? "✓" : "○"} Public contact email set</li>
      </ul>
    </Callout>
  );
  const switchControl = (
    <div className="flex items-center justify-between gap-4 border-b border-border pb-4">
      <div>
        <Label htmlFor="enable-whatsapp">Enable WhatsApp</Label>
        <p className="mt-1 text-sm text-muted-foreground">
          Let prospects reach your School’s Assistant on WhatsApp.
        </p>
      </div>
      <PrototypeSwitch
        id="enable-whatsapp"
        checked={enabled}
        disabled={!eligible || state === "buying" || state === "popup"}
        onCheckedChange={(checked) => {
          if (checked) enable();
          else if (live || broken) {
            setResumeState(state);
            setDisableOpen(true);
          } else go("off");
        }}
      />
    </div>
  );
  const costs = (
    <Callout title="Your School owns its WhatsApp account">
      Fillthemat buys and pays for a new US number. You authorize your School’s
      account in Meta’s one-time popup and add your School’s card in WhatsApp
      Manager to pay Meta’s message fees. Your existing phone number does not
      move.
    </Callout>
  );
  const action = (
    <div className="flex flex-col items-start gap-3" aria-live="polite">
      {state === "live" && !eligible ? (
        <Callout tone="warning" title="Not Live — School details required">
          Complete approval, publication, School phone, and public contact email
          before the Assistant can be Live on WhatsApp.
        </Callout>
      ) : null}
      {state === "off" ? (
        <p className="text-sm text-muted-foreground">
          Switch on when you’re ready. Have your personal Facebook login and a
          School payment card handy.
        </p>
      ) : null}
      {state === "buying" ? (
        <Callout title="Setting up your new number…">
          Fillthemat is buying a US number in the background. This is not Live
          yet.
        </Callout>
      ) : null}
      {["cancelled", "popup-failed"].includes(state) ? (
        <>
          <Callout
            tone="warning"
            title={
              state === "cancelled"
                ? "Meta setup cancelled — WhatsApp is off"
                : "Meta popup did not complete — WhatsApp is off"
            }
          >
            {state === "cancelled"
              ? "You closed Meta before finishing. The Assistant is not live on WhatsApp."
              : "Allow popups for Fillthemat, then try again. No WhatsApp connection was completed."}{" "}
            Your reserved number is {number}.
          </Callout>
          <Button disabled={!eligible} onClick={openPopup}>
            Resume Meta setup
          </Button>
        </>
      ) : null}
      {state === "failed" ? (
        <>
          <Callout tone="warning" title="Provisioning: failed">
            We could not set up your number. WhatsApp is off; your Assistant
            still works on the web.
          </Callout>
          <Button disabled={!eligible} onClick={enable}>
            Try setup again
          </Button>
        </>
      ) : null}
      {state === "needs-card" || state === "registering" ? (
        <>
          <Callout title="Provisioning: succeeded · Not Live yet">
            {state === "needs-card"
              ? "Your number is registered. Add a card in WhatsApp Manager to finish."
              : "Your card is on file. The number is not registered yet."}
          </Callout>
          {readiness}
          {state === "needs-card" ? (
            <Button onClick={openManager}>
              Add a card in WhatsApp Manager ↗
            </Button>
          ) : null}
          <Button
            variant="outline"
            onClick={() => {
              if (registered && managerSaved) go("live");
            }}
          >
            Check readiness
          </Button>
          <p className="text-xs text-muted-foreground">
            The real flow checks Meta, not a checkbox saying “I added it.” Mock
            the successful check in the demo controls below.
          </p>
        </>
      ) : null}
      {live ? (
        <>
          <Badge variant="success">Live · Working</Badge>
          <p className="text-sm">
            Prospects who text this number reach your School’s Assistant.
          </p>
          <div className="grid w-full gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <p className="text-xl font-semibold">{number}</p>
              <p className="text-sm">Profile name: {profile}</p>
              <p className="break-all text-sm underline">{waLink}</p>
              <Button
                variant="outline"
                onClick={async () => {
                  await navigator.clipboard.writeText(waLink);
                  setCopied(true);
                }}
              >
                {copied ? "Link copied" : "Copy wa.me link"}
              </Button>
            </div>
            <div className="flex flex-col items-center gap-1">
              <MockQr />
              <p className="text-xs text-muted-foreground">
                Mock QR · not scannable
              </p>
            </div>
          </div>
          <Callout title="Your School page now shows a WhatsApp link">
            <p>
              /s/{school.slug} · WhatsApp → {number}
            </p>
            <p className="mt-1">
              Share this number, wa.me link, or QR code. Demo number only — do
              not message it.
            </p>
          </Callout>
          {readiness}
        </>
      ) : null}
      {state === "cooling" ? (
        <>
          <Badge variant="muted">Off · 30-day cooling-off</Badge>
          <p className="text-sm">
            We’re holding {number} until <strong>November 11, 2026</strong> (30
            days). Switch back on before then to keep the same number. After
            that it is released; enabling again gets a new number.
          </p>
          <Callout title="What prospects see during cooling-off">
            “This School is no longer available on WhatsApp here. To reach a
            person, call {phone} or email {email}.”
          </Callout>
          <p className="text-xs text-muted-foreground">
            The Assistant is off and the WhatsApp link is removed from /s/
            {school.slug}. After release, we cannot reply to messages at the old
            number.
          </p>
          <Button disabled={!eligible} onClick={enable}>
            Switch back on · keep {number}
          </Button>
        </>
      ) : null}
      {state === "released" ? (
        <>
          <Callout title="Off · number released">
            The 30-day cooling-off ended. {number} is no longer yours and may be
            recycled by the carrier. Old wa.me links and QR codes must not be
            shared. We cannot answer messages at the old number.
          </Callout>
          <Button disabled={!eligible} onClick={enable}>
            Enable with a new number
          </Button>
        </>
      ) : null}
      {broken ? (
        <>
          <Badge variant="destructive">Broken · {brokenCopy[state].part}</Badge>
          <p className="text-sm">{brokenCopy[state].body}</p>
          <p className="text-xs text-muted-foreground">
            Web chat is unaffected. Do not assume prospects receive a reply
            while WhatsApp is broken.
          </p>
          <Button
            disabled={!eligible}
            onClick={() => {
              if (state === "broken-access") openPopup();
              else if (state === "broken-number") enable();
              else openManager();
            }}
          >
            {brokenCopy[state].action}
          </Button>
          <p className="text-xs text-muted-foreground">
            Suggested repair action for discussion, not an implemented recovery
            guarantee.
          </p>
        </>
      ) : null}
    </div>
  );
  const steps = [
    {
      title: "1. New US number",
      body: "Fillthemat purchases it in the background.",
      done: hasNumber,
    },
    {
      title: "2. One-time Meta signup",
      body: "Facebook → business → profile → number → code → terms.",
      done: registered || card,
    },
    {
      title: "3. School card in Meta",
      body: "Pay Meta’s message fees directly.",
      done: card,
    },
  ];

  return (
    <div className="flex flex-col gap-5 pb-24">
      <Callout title="THROWAWAY PROTOTYPE · do not merge">
        What should the School Owner’s Enable WhatsApp flow look like? All
        numbers, codes, Meta screens, cards, and states are simulated. No vendor
        calls or saved changes. Other Settings navigation leaves the demo.
      </Callout>
      {variant === "B" ? (
        <VariantB
          switchControl={switchControl}
          preflight={preflight}
          contact={contact}
          costs={costs}
          action={action}
          state={state}
        />
      ) : variant === "C" ? (
        <VariantC
          switchControl={switchControl}
          preflight={preflight}
          contact={contact}
          costs={costs}
          action={action}
          readiness={readiness}
          provisioning={provisioning}
        />
      ) : (
        <VariantA
          switchControl={switchControl}
          preflight={preflight}
          contact={contact}
          costs={costs}
          action={action}
          steps={steps}
        />
      )}
      <details className="rounded-md border border-border p-3" open>
        <summary className="cursor-pointer text-sm font-semibold">
          Prototype controls · jump to any state
        </summary>
        <p className="mt-2 text-xs text-muted-foreground">
          Demo clock: October 12, 2026. Cooling-off ends November 11, 2026.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <SelectField
            label="Layout"
            name="variant"
            value={variant}
            onValueChange={(value) => {
              const query = new URLSearchParams(params);
              query.set("variant", value);
              router.replace(`${pathname}?${query}`, { scroll: false });
            }}
            options={[
              { value: "A", label: "A · Inline checklist" },
              { value: "B", label: "B · One next step" },
              { value: "C", label: "C · Split responsibilities" },
            ]}
          />
          <SelectField
            label="Scenario"
            name="scenario"
            value={state}
            onValueChange={(value) => {
              setPopupStep(0);
              setManagerSaved(false);
              go(parseState(value));
            }}
            options={states.map((value) => ({
              value,
              label: stateLabels[value],
            }))}
          />
          <SelectField
            label="Eligibility gate"
            name="eligibility"
            value={eligibility}
            onValueChange={(value) => {
              setEligibility(value);
              if (value === "no-phone") setPhone("");
              if (value === "no-email") setEmail("");
              go("off");
            }}
            options={[
              { value: "school", label: "School’s current details" },
              { value: "unapproved", label: "School not approved" },
              { value: "unpublished", label: "School not published" },
              { value: "no-phone", label: "Missing School phone" },
              { value: "no-email", label: "Missing contact email" },
            ]}
          />
          <div className="flex flex-wrap items-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setApprovedOverride(true);
                setEligibility("school");
                setPhone("+1 (202) 555-0100");
                setEmail("hello@example.com");
              }}
            >
              Use eligible demo details
            </Button>
            {state === "buying" ? (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => go("failed")}
              >
                Fail number purchase
              </Button>
            ) : null}
            {state === "registering" ? (
              <Button size="sm" onClick={() => go("live")}>
                Simulate registration succeeded
              </Button>
            ) : null}
            {state === "needs-card" ? (
              <Button size="sm" onClick={() => go("live")}>
                Simulate Meta confirms card
              </Button>
            ) : null}
            {state === "cooling" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => go("released")}
              >
                Advance past day 30
              </Button>
            ) : null}
          </div>
        </div>
        <pre className="mt-3 overflow-x-auto text-xs text-muted-foreground">
          {JSON.stringify(
            {
              variant,
              state,
              eligible,
              approved,
              published,
              phoneSet: hasPhone,
              publicEmailSet: hasEmail,
              enableSwitch: enabled,
              provisioning,
              number: hasNumber ? number : null,
              registered,
              cardOnFile: card,
              assistantLive: live,
              health: broken ? "broken" : live ? "working" : null,
              brokenPart: broken ? brokenCopy[state].part : null,
              popupStep: state === "popup" ? popupSteps[popupStep] : null,
              publicPageLink: live,
              coolingOffDays: state === "cooling" ? 30 : null,
            },
            null,
            2,
          )}
        </pre>
      </details>
      <PrototypeSwitcher />
      <AlertDialog
        open={state === "popup"}
        onOpenChange={(open) => {
          if (!open) go("cancelled");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Mock Meta popup · {popupStep + 1} of 6
            </AlertDialogTitle>
            <AlertDialogDescription>
              {popupSteps[popupStep]} · Not Meta’s final UI; no credentials are
              collected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Callout title="On your Fillthemat page, outside the real popup">
            <p>
              New US number: <strong>{number}</strong>
            </p>
            {popupStep >= 4 ? (
              <p>
                Your verification code:{" "}
                <strong className="font-mono text-lg">482193</strong>
              </p>
            ) : (
              <p>Your 6-digit code will appear here when Meta sends it.</p>
            )}
            <p className="mt-1 text-xs">
              Keep Settings open and enter these details in Meta.
            </p>
          </Callout>
          {popupStep === 0 ? (
            <p className="text-sm">
              Continue with your personal Facebook login to authorize the
              School’s business. This demo does not ask for a password.
            </p>
          ) : null}
          {popupStep === 1 ? (
            <>
              <SelectField
                label="Business"
                name="business"
                value={business}
                onValueChange={setBusiness}
                options={[
                  { value: school.name, label: school.name },
                  { value: "new", label: "Create a new School business" },
                ]}
              />
              {business === "new" ? (
                <p className="text-xs text-muted-foreground">
                  Demo: a new business named {school.name} will be created.
                </p>
              ) : null}
            </>
          ) : null}
          {popupStep === 2 ? (
            <TextField
              label="WhatsApp profile name"
              name="profile"
              value={profile}
              onValueChange={setProfile}
              required
            />
          ) : null}
          {popupStep === 3 ? (
            <TextField
              label="Number shown by Fillthemat"
              name="newNumber"
              type="tel"
              value={enteredNumber}
              onValueChange={setEnteredNumber}
              helper="Use the new number above, not your existing School phone."
            />
          ) : null}
          {popupStep === 4 ? (
            <TextField
              label="6-digit verification code"
              name="verificationCode"
              value={code}
              onValueChange={setCode}
              inputMode="numeric"
              maxLength={6}
              helper="Type 482193 from the Fillthemat page. This is not a PIN or password."
            />
          ) : null}
          {popupStep === 5 ? (
            <p className="text-sm">
              Accept Meta’s terms and give Fillthemat access to your School’s
              WhatsApp account. Your School owns the account; Fillthemat runs
              its school-specific Assistant.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={
                (popupStep === 2 && !profile.trim()) ||
                (popupStep === 3 &&
                  enteredNumber.replace(/\D/g, "") !==
                    number.replace(/\D/g, "")) ||
                (popupStep === 4 && code !== "482193")
              }
              onClick={() => {
                if (popupStep === 5) go("needs-card");
                else setPopupStep(popupStep + 1);
              }}
            >
              {popupStep === 0
                ? "Continue with Facebook (mock)"
                : popupStep === 5
                  ? "Accept terms & finish"
                  : "Continue"}
            </Button>
            <Button variant="outline" onClick={() => go("cancelled")}>
              Cancel popup
            </Button>
            <Button variant="destructive" onClick={() => go("popup-failed")}>
              Simulate popup failure
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={managerOpen} onOpenChange={setManagerOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mock external WhatsApp Manager</AlertDialogTitle>
            <AlertDialogDescription>
              In the real flow this opens Meta billing in a new tab. Your School
              pays Meta directly; Fillthemat pays for the number.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="text-sm">
            School: {school.name}
            <br />
            Payment method:{" "}
            {managerSaved ? "Visa •••• 4242 (demo)" : "No card on file"}
          </p>
          <p className="text-xs text-muted-foreground">
            No card data is collected. Returning without a card does not make
            WhatsApp Live.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                setManagerSaved(true);
              }}
            >
              Add demo card
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setManagerOpen(false);
                if (managerSaved && state === "needs-card") go("live");
              }}
            >
              Return to Settings & check
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={disableOpen} onOpenChange={setDisableOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch WhatsApp off?</AlertDialogTitle>
            <AlertDialogDescription>
              Your Assistant stops replying on WhatsApp and the link disappears
              from your School page. We hold {number} for 30 days, until
              November 11, 2026. Switch back on in time to keep it; after
              release you’ll need a new number.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="text-sm">
            During cooling-off, prospects get a fixed reply with your School
            phone and email. Web chat stays on.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="destructive"
              onClick={() => {
                setDisableOpen(false);
                go("cooling");
              }}
            >
              Switch off · hold for 30 days
            </Button>
            <Button variant="outline" onClick={() => setDisableOpen(false)}>
              Keep WhatsApp on
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

type LayoutProps = {
  switchControl: React.ReactNode;
  preflight: React.ReactNode;
  contact: React.ReactNode;
  costs: React.ReactNode;
  action: React.ReactNode;
};

export function VariantA({
  switchControl,
  preflight,
  contact,
  costs,
  action,
  steps,
}: LayoutProps & { steps: { title: string; body: string; done: boolean }[] }) {
  return (
    <div className="flex flex-col gap-5">
      {switchControl}
      {preflight}
      {contact}
      {costs}
      <ol className="flex flex-col gap-3 border-l border-border pl-4">
        {steps.map((step) => (
          <li key={step.title}>
            <p className="text-sm font-semibold">
              {step.done ? "✓ " : "○ "}
              {step.title}
            </p>
            <p className="text-xs text-muted-foreground">{step.body}</p>
          </li>
        ))}
      </ol>
      {action}
    </div>
  );
}

export function VariantB({
  switchControl,
  preflight,
  contact,
  costs,
  action,
  state,
}: LayoutProps & { state: State }) {
  return (
    <div className="flex flex-col gap-5">
      {switchControl}
      <div className="rounded-md border border-border p-4">
        <p className="mb-3 text-base font-semibold">
          {state === "off"
            ? "Start with your School’s contact details"
            : state === "live"
              ? "Ready to share"
              : state === "cooling"
                ? "Your number is on hold"
                : "Your next step"}
        </p>
        {state === "off" ? (
          <div className="flex flex-col gap-4">
            {preflight}
            {contact}
          </div>
        ) : (
          action
        )}
      </div>
      {state === "off" ? action : null}
      <details className="border-b border-border pb-3">
        <summary className="cursor-pointer text-sm font-medium">
          How setup works · number → Meta signup → card → Live
        </summary>
        <div className="mt-3">{costs}</div>
      </details>
      {state !== "off" ? (
        <details>
          <summary className="cursor-pointer text-sm font-medium">
            School contact & eligibility
          </summary>
          <div className="mt-3 flex flex-col gap-4">
            {preflight}
            {contact}
          </div>
        </details>
      ) : null}
    </div>
  );
}

export function VariantC({
  switchControl,
  preflight,
  contact,
  costs,
  action,
  readiness,
  provisioning,
}: LayoutProps & { readiness: React.ReactNode; provisioning: string }) {
  return (
    <div className="flex flex-col gap-5">
      {switchControl}
      {costs}
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="flex flex-col gap-5">
          <h3 className="text-base font-semibold">
            School Owner · what you do
          </h3>
          {contact}
          {action}
        </div>
        <aside className="flex flex-col gap-4 border-l border-border pl-4">
          <h3 className="text-base font-semibold">
            Fillthemat · what we check
          </h3>
          {preflight}
          <p className="text-sm">
            Number provisioning: <strong>{provisioning}</strong>
          </p>
          {readiness}
          <p className="text-xs text-muted-foreground">
            We buy and register the number. Meta holds the School’s account and
            card.
          </p>
        </aside>
      </div>
    </div>
  );
}

function MockQr() {
  return (
    <svg
      width="112"
      height="112"
      viewBox="0 0 25 25"
      role="img"
      aria-label="Illustrative QR code placeholder, not scannable"
    >
      <rect width="25" height="25" fill="var(--color-background)" />
      <path
        fill="var(--color-foreground)"
        d="M2 2h7v7H2zM16 2h7v7h-7zM2 16h7v7H2zM11 2h2v3h-2zM11 7h3v4h-3zM16 11h7v2h-7zM11 14h3v9h-3zM16 16h3v3h-3zM21 15h2v8h-2zM15 21h5v2h-5zM2 11h6v3H2z"
      />
      <path
        fill="var(--color-background)"
        d="M3 3h5v5H3zM17 3h5v5h-5zM3 17h5v5H3z"
      />
      <path
        fill="var(--color-foreground)"
        d="M4 4h3v3H4zM18 4h3v3h-3zM4 18h3v3H4z"
      />
    </svg>
  );
}
