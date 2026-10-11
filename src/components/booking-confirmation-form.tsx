"use client";

import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { useRef, useState } from "react";
import { submitBooking } from "./booking-submission";
import { readConversationToken } from "./browser-token";
import { readLandingSessionToken } from "./landing-session";

export type ConfirmationValues = {
  schoolName: string;
  slug: string;
  offeringId: string;
  offeringName: string;
  slotId: string;
  whenLabel: string;
  location: string | null;
  participantName: string;
  participantAge: number;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
};

export function BookingConfirmationForm({
  values,
  onBooked,
}: {
  values: ConfirmationValues;
  onBooked: (result: { offeringName: string; whenLabel: string }) => void;
}) {
  const [contactName, setContactName] = useState(values.contactName);
  const [contactEmail, setContactEmail] = useState(values.contactEmail);
  const [contactPhone, setContactPhone] = useState(values.contactPhone);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const bookingKeys = useRef<Record<string, { current: string | null }>>({});
  const turnstile = useRef<TurnstileInstance | undefined>(undefined);
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    // Keep retries of an uncertain outcome idempotent, but allow a different
    // participant or trial occurrence to start a separate booking intent.
    const intent = JSON.stringify([
      values.slug,
      values.offeringId,
      values.slotId,
      values.participantName,
      values.participantAge,
    ]);
    bookingKeys.current[intent] ??= { current: null };
    const key = bookingKeys.current[intent];
    await submitBooking({
      key,
      setPending,
      setError,
      resetVerification: () => {
        setTurnstileToken("");
        turnstile.current?.reset();
      },
      buildBody: (idempotencyKey) => ({
        schoolSlug: values.slug,
        offeringId: values.offeringId,
        slotId: values.slotId,
        idempotencyKey,
        contact: {
          name: contactName,
          email: contactEmail,
          phone: contactPhone,
        },
        participant: {
          name: values.participantName,
          age: values.participantAge,
        },
        turnstileToken,
        landingSessionToken: readLandingSessionToken(values.slug),
        conversationResumeToken: readConversationToken(values.slug),
      }),
      onBooked: () =>
        onBooked({
          offeringName: values.offeringName,
          whenLabel: values.whenLabel,
        }),
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded-2xl border border-page-200 bg-white p-4 text-sm"
    >
      <h2 className="text-base font-semibold">Confirm your trial</h2>
      <p>{values.schoolName}</p>
      <p>{values.offeringName}</p>
      <p>
        {values.participantName}, age {values.participantAge}
      </p>
      <p>{values.whenLabel}</p>
      {values.location ? <p>{values.location}</p> : null}
      <input
        required
        value={contactName}
        onChange={(event) => setContactName(event.target.value)}
        placeholder="Adult name"
        className="rounded-md border border-page-300 px-3 py-2"
      />
      <input
        required
        type="email"
        value={contactEmail}
        onChange={(event) => setContactEmail(event.target.value)}
        placeholder="Email"
        className="rounded-md border border-page-300 px-3 py-2"
      />
      <input
        required
        value={contactPhone}
        onChange={(event) => setContactPhone(event.target.value)}
        placeholder="Phone"
        className="rounded-md border border-page-300 px-3 py-2"
      />
      {siteKey ? (
        <Turnstile
          ref={turnstile}
          siteKey={siteKey}
          onSuccess={setTurnstileToken}
          onExpire={() => setTurnstileToken("")}
          onError={() => setTurnstileToken("")}
        />
      ) : (
        <p className="text-page-error">Turnstile is not configured.</p>
      )}
      {error ? (
        <p role="alert" className="text-page-error">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending || !turnstileToken}
        className="h-11 rounded-full bg-page-950 text-white disabled:opacity-50"
      >
        {pending ? "Booking…" : "Confirm trial"}
      </button>
    </form>
  );
}
