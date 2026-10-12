"use client";

import { useState, useTransition } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { switchOffWhatsAppAction } from "../whatsapp-actions";

export function releaseDateLabel(at: Date) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(at);
}

export function WhatsAppSwitchOff({
  releaseAt,
  onClose,
}: {
  releaseAt: Date | null;
  onClose: () => void;
}) {
  const [pending, transition] = useTransition();
  const [error, setError] = useState("");
  return (
    <AlertDialog
      open={!!releaseAt}
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogTitle>Switch WhatsApp off?</AlertDialogTitle>
        <AlertDialogDescription>
          Your number will be released on{" "}
          {releaseAt ? releaseDateLabel(releaseAt) : ""} (UTC), after 30 days.
          Switch back on before then to keep the same number. During
          cooling-off, prospects get only your school phone and public contact
          email. Old links and QR codes stop working after release.
        </AlertDialogDescription>
        {error ? <p role="alert">{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            Keep WhatsApp on
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(event) => {
              event.preventDefault();
              transition(async () => {
                try {
                  const result = await switchOffWhatsAppAction();
                  if (result.status === "error")
                    setError(result.message ?? "Switch-off failed.");
                  else onClose();
                } catch {
                  setError(
                    "We could not switch WhatsApp off. Reload settings and try again.",
                  );
                }
              });
            }}
          >
            {pending ? "Switching off…" : "Switch off"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
