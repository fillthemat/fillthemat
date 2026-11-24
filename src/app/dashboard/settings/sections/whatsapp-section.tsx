"use client";

import Script from "next/script";
import { useEffect, useRef, useState, useTransition } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Callout } from "../ui/controls";
import { completeWhatsAppSignup, updateWhatsAppPopup } from "../whatsapp-actions";

type FacebookSdk = {
  init: (options: { appId: string; version: string; xfbml: boolean }) => void;
  login: (
    callback: (response: { authResponse?: { code?: string } }) => void,
    options: Record<string, unknown>,
  ) => void;
};
declare global {
  interface Window {
    FB?: FacebookSdk;
  }
}
const signupEvent = z.object({
  type: z.literal("WA_EMBEDDED_SIGNUP"),
  event: z.enum(["FINISH", "CANCEL", "ERROR"]),
  data: z.object({ waba_id: z.string(), phone_number_id: z.string() }).partial().optional(),
});
type Attempt = { code?: string; wabaId?: string; phoneNumberId?: string; submitted?: boolean };

export function WhatsAppSection({
  appId,
  configId,
  apiVersion,
  configured,
  eligible,
  connection,
  business,
}: {
  appId: string | null;
  configId: string | null;
  apiVersion: string;
  configured: boolean;
  eligible: boolean;
  connection: {
    state: string;
    display_phone_number: string | null;
    failure_code: string | null;
  } | null;
  business: { name: string; email: string; website: string; country: string };
}) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const attempt = useRef<Attempt | null>(null);

  function failPopup(state: "cancelled" | "popup-failed") {
    if (!attempt.current || attempt.current.submitted) return;
    attempt.current = null;
    setBusy(false);
    setMessage(
      state === "cancelled" ? "Signup cancelled. You can retry." : "Popup failed. Please retry.",
    );
    startTransition(async () => {
      try {
        await updateWhatsAppPopup(state);
      } catch {
        setMessage("Could not save signup state. Please retry.");
      }
    });
  }

  function completeIfReady() {
    const current = attempt.current;
    if (!current || current.submitted || !current.code || !current.wabaId || !current.phoneNumberId)
      return;
    current.submitted = true;
    const input = {
      code: current.code,
      wabaId: current.wabaId,
      phoneNumberId: current.phoneNumberId,
    };
    setMessage("Registering your number…");
    startTransition(async () => {
      try {
        const result = await completeWhatsAppSignup(input);
        setMessage(
          result.ok
            ? "Your WhatsApp assistant is live."
            : `Connection failed (${result.code}). Please retry.`,
        );
      } catch {
        setMessage("Connection failed. Please retry.");
      } finally {
        attempt.current = null;
        setBusy(false);
      }
    });
  }

  useEffect(() => {
    function receive(event: MessageEvent) {
      if (!["https://www.facebook.com", "https://web.facebook.com"].includes(event.origin)) return;
      if (!attempt.current || attempt.current.submitted) return;
      let payload: unknown = event.data;
      if (typeof payload === "string") {
        try {
          payload = JSON.parse(payload);
        } catch {
          return;
        }
      }
      const parsed = signupEvent.safeParse(payload);
      if (!parsed.success) return;
      if (parsed.data.event === "CANCEL") return failPopup("cancelled");
      if (parsed.data.event === "ERROR") return failPopup("popup-failed");
      attempt.current.wabaId = parsed.data.data?.waba_id;
      attempt.current.phoneNumberId = parsed.data.data?.phone_number_id;
      completeIfReady();
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);

  function connect() {
    if (!window.FB || busy) return;
    const current: Attempt = {};
    attempt.current = current;
    setBusy(true);
    setMessage("Complete signup in the Meta popup.");
    startTransition(async () => {
      try {
        await updateWhatsAppPopup("popup");
      } catch {
        failPopup("popup-failed");
      }
    });
    try {
      window.FB.login(
        (response) => {
          if (attempt.current !== current || current.submitted) return;
          const code = response.authResponse?.code;
          if (!code) return failPopup("cancelled");
          attempt.current.code = code;
          completeIfReady();
        },
        {
          config_id: configId,
          response_type: "code",
          override_default_response_type: true,
          extras: {
            setup: {
              business: {
                name: business.name,
                email: business.email,
                website: business.website,
                address: { country: business.country },
              },
              phone: {
                displayName: business.name,
                category: "EDU",
                description: `Trial classes at ${business.name}`,
              },
            },
            featureType: "",
            sessionInfoVersion: "3",
          },
        },
      );
    } catch {
      failPopup("popup-failed");
    }
  }

  return (
    <div className="flex flex-col items-start gap-5">
      {configured && eligible ? (
        <Script
          src="https://connect.facebook.net/en_US/sdk.js"
          onReady={() => {
            if (appId && window.FB) {
              window.FB.init({ appId, version: apiVersion, xfbml: false });
              setReady(true);
            }
          }}
          onError={() => setMessage("Meta's SDK could not load. Refresh to retry.")}
        />
      ) : null}
      <p>State: {connection?.state ?? "off"}</p>
      <p>{connection?.display_phone_number ?? "No display number connected yet."}</p>
      {connection?.failure_code ? (
        <Callout>Connection needs attention: {connection.failure_code}. You can retry.</Callout>
      ) : null}
      {!eligible ? (
        <Callout>Your school must be approved and published before connecting WhatsApp.</Callout>
      ) : null}
      {!configured ? (
        <Callout>
          WhatsApp signup is not configured. Ask Fill the Mat to configure the Meta app and
          encryption key.
        </Callout>
      ) : null}
      <Button onClick={connect} disabled={!eligible || !configured || !ready || busy || pending}>
        {busy ? "Connecting…" : "Connect WhatsApp"}
      </Button>
      {busy ? (
        <Button variant="outline" onClick={() => failPopup("cancelled")} disabled={pending}>
          Cancel Signup
        </Button>
      ) : null}
      <p role="status">{message}</p>
    </div>
  );
}
