"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { WhatsAppConnectionView } from "@/lib/whatsapp/connection";
import { Callout } from "../ui/controls";
import {
  completeWhatsAppSignupAction,
  endWhatsAppSignupAction,
  readWhatsAppSignupAction,
  startWhatsAppSignupAction,
} from "../whatsapp-actions";

export type EmbeddedSignupConfig = {
  appId: string;
  configId: string;
  version: string;
};
type FacebookSdk = {
  init(config: {
    appId: string;
    version: string;
    xfbml: boolean;
    autoLogAppEvents: boolean;
  }): void;
  login(
    callback: (response: { authResponse?: { code?: string } }) => void,
    options: {
      config_id: string;
      response_type: "code";
      override_default_response_type: true;
      extras: { setup: Record<string, never> };
    },
  ): void;
};
declare global {
  interface Window {
    FB?: FacebookSdk;
  }
}
type ActivePopup = {
  attemptId: string;
  code?: string;
  wabaId?: string;
  phoneNumberId?: string;
  settled: boolean;
};

export function WhatsAppSignup({
  connection,
  config,
}: {
  connection: WhatsAppConnectionView;
  config: EmbeddedSignupConfig | null;
}) {
  const [view, setView] = useState<WhatsAppConnectionView | null>(null);
  const current = view ?? connection;
  const [ready, setReady] = useState(false);
  const [prepared, setPrepared] = useState(false);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const active = useRef<ActivePopup | null>(null);
  const codeTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCodeTimeout = useCallback(() => {
    if (codeTimeout.current) clearTimeout(codeTimeout.current);
    codeTimeout.current = null;
  }, []);
  const finish = useCallback(
    (outcome: "cancelled" | "failed") => {
      const popup = active.current;
      if (!popup || popup.settled) return;
      popup.settled = true;
      delete popup.code;
      clearCodeTimeout();
      setOpen(false);
      setPrepared(false);
      startTransition(async () => {
        try {
          const result = await endWhatsAppSignupAction(
            popup.attemptId,
            outcome,
          );
          setView(result.connection);
          setMessage(
            outcome === "cancelled"
              ? "Signup cancelled. Your number is kept; resume when you’re ready."
              : "Meta signup failed. Your number is kept; try again.",
          );
        } catch {
          setMessage(
            "We could not save signup status. Reload settings before retrying.",
          );
        }
      });
    },
    [clearCodeTimeout],
  );
  const complete = useCallback(() => {
    const popup = active.current;
    if (
      !popup ||
      popup.settled ||
      !popup.code ||
      !popup.wabaId ||
      !popup.phoneNumberId
    )
      return;
    popup.settled = true;
    clearCodeTimeout();
    const input = {
      attemptId: popup.attemptId,
      code: popup.code,
      wabaId: popup.wabaId,
      phoneNumberId: popup.phoneNumberId,
    };
    // Never retain the exchange code in component state or log Meta's response.
    delete popup.code;
    setOpen(false);
    setPrepared(false);
    setView((view) =>
      view ? { ...view, state: "registering", verificationCode: null } : view,
    );
    setMessage("Registering your number with Meta. WhatsApp is not Live yet.");
    startTransition(async () => {
      try {
        const result = await completeWhatsAppSignupAction(input);
        setView(result.connection);
        setMessage(
          result.ok
            ? "Number registered. Add your school’s card next; WhatsApp is not Live yet."
            : "Meta setup failed. Your number is kept; try again.",
        );
      } catch {
        setMessage(
          "We could not complete registration. Reload settings and retry signup.",
        );
      }
    });
  }, [clearCodeTimeout]);

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (
        ![
          "https://www.facebook.com",
          "https://web.facebook.com",
          "https://facebook.com",
        ].includes(event.origin)
      )
        return;
      const popup = active.current;
      if (!popup || popup.settled) return;
      let data: unknown;
      try {
        data =
          typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      if (
        !data ||
        typeof data !== "object" ||
        !("type" in data) ||
        data.type !== "WA_EMBEDDED_SIGNUP" ||
        !("event" in data)
      )
        return;
      if (data.event === "ERROR") {
        finish("failed");
        return;
      }
      if (data.event === "CANCEL") {
        finish(
          "data" in data &&
            data.data &&
            typeof data.data === "object" &&
            "error_message" in data.data
            ? "failed"
            : "cancelled",
        );
        return;
      }
      if (
        data.event !== "FINISH" ||
        !("data" in data) ||
        !data.data ||
        typeof data.data !== "object"
      )
        return;
      const assets = data.data;
      if (
        !("waba_id" in assets) ||
        !("phone_number_id" in assets) ||
        typeof assets.waba_id !== "string" ||
        typeof assets.phone_number_id !== "string"
      ) {
        finish("failed");
        return;
      }
      popup.wabaId = assets.waba_id;
      popup.phoneNumberId = assets.phone_number_id;
      complete();
    };
    window.addEventListener("message", listener);
    let disposed = false;
    const poll = open
      ? setInterval(async () => {
          try {
            const next = await readWhatsAppSignupAction();
            if (!disposed) setView(next);
          } catch {
            if (!disposed)
              setMessage(
                "Verification code could not refresh. Check your connection or reload settings.",
              );
          }
        }, 2000)
      : null;
    return () => {
      disposed = true;
      if (poll) clearInterval(poll);
      window.removeEventListener("message", listener);
    };
  }, [open, finish, complete]);
  useEffect(
    () => () => {
      if (codeTimeout.current) clearTimeout(codeTimeout.current);
      active.current = null;
    },
    [],
  );

  if (!config)
    return (
      <Callout title="Meta signup unavailable" tone="warning">
        Contact Fillthemat to finish Meta setup. Your reserved number is kept.
      </Callout>
    );
  if (["needs-card", "live"].includes(current.state))
    return <p role="status">{message}</p>;
  return (
    <div className="flex flex-col items-start gap-3">
      <Script
        src="https://connect.facebook.net/en_US/sdk.js"
        onReady={() => {
          if (!window.FB) return;
          window.FB.init({
            appId: config.appId,
            version: config.version,
            xfbml: false,
            autoLogAppEvents: false,
          });
          setReady(true);
        }}
        onError={() =>
          setMessage(
            "Meta could not load. Check your connection and reload settings.",
          )
        }
      />
      <Callout title="Your number and verification code">
        <p>
          Enter <strong>{current.number}</strong> as your new WhatsApp number in
          Meta’s popup.
        </p>
        <p aria-live="polite">
          Verification code:{" "}
          <strong>
            {open
              ? (current.verificationCode ?? "Waiting for Meta’s SMS…")
              : "Open the popup to request a code"}
          </strong>
        </p>
        <p>
          Keep settings open beside the popup. Use your school’s name for the
          profile. Your existing WhatsApp number stays untouched.
        </p>
      </Callout>
      {open ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => finish("cancelled")}
        >
          Cancel signup
        </Button>
      ) : prepared ? (
        <Button
          type="button"
          disabled={!ready || pending}
          onClick={() => {
            if (!window.FB || !current.attemptId) return;
            const launched: ActivePopup = {
              attemptId: current.attemptId,
              settled: false,
            };
            active.current = launched;
            setOpen(true);
            setMessage("");
            try {
              // FB.login must run directly in the click handler, not after an await,
              // otherwise browsers block the popup. Preparation is a separate step.
              window.FB.login(
                (response) => {
                  const popup = active.current;
                  if (popup !== launched || popup.settled) return;
                  if (!response.authResponse?.code) {
                    finish("cancelled");
                    return;
                  }
                  popup.code = response.authResponse.code;
                  complete();
                  if (!popup.settled)
                    codeTimeout.current = setTimeout(
                      () => finish("failed"),
                      10_000,
                    );
                },
                {
                  config_id: config.configId,
                  response_type: "code",
                  override_default_response_type: true,
                  extras: { setup: {} },
                },
              );
            } catch {
              finish("failed");
            }
          }}
        >
          Open Meta popup
        </Button>
      ) : (
        <Button
          type="button"
          disabled={!ready || pending || current.state === "registering"}
          onClick={() =>
            startTransition(async () => {
              try {
                const result = await startWhatsAppSignupAction();
                setView(result.connection);
                setPrepared(result.ok);
                setMessage(
                  result.ok
                    ? "Ready. Open Meta’s popup to sign in with Facebook."
                    : "Signup is already in progress. Reload settings to see the current status.",
                );
              } catch {
                setMessage(
                  "Signup could not start. Reload settings and try again.",
                );
              }
            })
          }
        >
          {current.state === "cancelled"
            ? "Resume Meta signup"
            : current.state === "broken-access"
              ? "Reconnect with Meta"
              : current.state === "popup-failed"
                ? "Retry Meta signup"
                : "Prepare Meta signup"}
        </Button>
      )}
      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}
    </div>
  );
}
