"use client";

import { Turnstile } from "@marsidev/react-turnstile";
import { useEffect, useState } from "react";
import {
  BookingConfirmationForm,
  type ConfirmationValues,
} from "./booking-confirmation-form";
import { readLandingSessionToken } from "./landing-session";

type Offering = {
  id: string;
  name: string;
  description: string | null;
  minimumAge: number | null;
  maximumAge: number | null;
  active: boolean;
};

type Slot = {
  slotId: string;
  localDateLabel: string;
  localTimeLabel: string;
  remaining: number;
};

/**
 * A trial offering and slot the assistant proposed. Book Trial starts with
 * them selected.
 */
export type ProposedTrial = {
  offeringId: string;
  slotId: string;
  offeringName: string;
  whenLabel: string;
};

export function BookingFlow({
  slug,
  schoolName,
  location,
  offerings,
  proposedTrial,
  preview = false,
}: {
  slug: string;
  schoolName: string;
  location: string | null;
  offerings: Offering[];
  proposedTrial?: ProposedTrial | null;
  preview?: boolean;
}) {
  const [offeringId, setOfferingId] = useState(proposedTrial?.offeringId ?? "");
  const [age, setAge] = useState("");
  const [participantName, setParticipantName] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [noMatch, setNoMatch] = useState(false);
  const [slotId, setSlotId] = useState(proposedTrial?.slotId ?? "");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationValues | null>(
    null,
  );
  const [done, setDone] = useState<string | null>(null);
  const [leadSent, setLeadSent] = useState(false);

  const activeOfferings = offerings.filter((offering) => offering.active);
  const selected = activeOfferings.find(
    (offering) => offering.id === offeringId,
  );

  useEffect(() => {
    if (!offeringId || age === "") return;
    void (async () => {
      const response = await fetch(
        `/api/slots?slug=${encodeURIComponent(slug)}&offeringId=${encodeURIComponent(offeringId)}&age=${encodeURIComponent(age)}${preview ? "&preview=1" : ""}`,
      );
      const payload = (await response.json()) as {
        slots: Slot[];
        noMatch?: boolean;
      };
      setSlots(payload.slots ?? []);
      setNoMatch(
        Boolean(payload.noMatch) || (payload.slots ?? []).length === 0,
      );
    })();
  }, [offeringId, age, slug, preview]);

  if (done) {
    return <p className="rounded-2xl border border-page-200 p-4">{done}</p>;
  }

  if (confirmation) {
    return (
      <BookingConfirmationForm
        values={confirmation}
        onBooked={({ offeringName, whenLabel }) =>
          setDone(
            `You're booked for ${offeringName} on ${whenLabel}. Check email for details.`,
          )
        }
      />
    );
  }

  function openConfirmation() {
    if (!selected || !slotId) return;
    const slot = slots.find((row) => row.slotId === slotId);
    setConfirmation({
      schoolName,
      slug,
      offeringId: selected.id,
      offeringName: selected.name,
      slotId,
      whenLabel: slot
        ? `${slot.localDateLabel} at ${slot.localTimeLabel}`
        : (proposedTrial?.whenLabel ?? ""),
      location,
      participantName,
      participantAge: Number(age),
      contactName,
      contactEmail,
      contactPhone,
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-page-200 bg-white p-4 text-sm">
      <h2 className="text-base font-semibold">Book Trial</h2>
      <select
        value={offeringId}
        onChange={(event) => setOfferingId(event.target.value)}
        className="rounded-md border border-page-300 px-3 py-2"
      >
        <option value="">Select a trial</option>
        {activeOfferings.map((offering) => (
          <option key={offering.id} value={offering.id}>
            {offering.name}
          </option>
        ))}
      </select>
      <input
        value={participantName}
        onChange={(event) => setParticipantName(event.target.value)}
        placeholder="Participant name"
        className="rounded-md border border-page-300 px-3 py-2"
      />
      <input
        value={age}
        onChange={(event) => setAge(event.target.value)}
        type="number"
        min={0}
        max={99}
        placeholder="Age in years"
        className="rounded-md border border-page-300 px-3 py-2"
      />
      {slots.length > 0 ? (
        <select
          value={slotId}
          onChange={(event) => setSlotId(event.target.value)}
          className="rounded-md border border-page-300 px-3 py-2"
        >
          <option value="">Select a time</option>
          {slots.map((slot) => (
            <option key={slot.slotId} value={slot.slotId}>
              {slot.localDateLabel} at {slot.localTimeLabel} ({slot.remaining}{" "}
              left)
            </option>
          ))}
        </select>
      ) : null}
      {noMatch ? (
        <LeadForm
          slug={slug}
          offeringId={offeringId || undefined}
          onSent={() => setLeadSent(true)}
        />
      ) : null}
      {leadSent ? <p>Thanks. The school will follow up.</p> : null}
      <input
        value={contactName}
        onChange={(event) => setContactName(event.target.value)}
        placeholder="Adult contact name"
        className="rounded-md border border-page-300 px-3 py-2"
      />
      <input
        value={contactEmail}
        onChange={(event) => setContactEmail(event.target.value)}
        type="email"
        placeholder="Email"
        className="rounded-md border border-page-300 px-3 py-2"
      />
      <input
        value={contactPhone}
        onChange={(event) => setContactPhone(event.target.value)}
        placeholder="Phone"
        className="rounded-md border border-page-300 px-3 py-2"
      />
      <button
        type="button"
        onClick={openConfirmation}
        disabled={!selected || !slotId || !participantName || age === ""}
        className="h-11 rounded-full bg-page-950 text-white disabled:opacity-40"
      >
        Review booking
      </button>
    </div>
  );
}

function LeadForm({
  slug,
  offeringId,
  onSent,
}: {
  slug: string;
  offeringId?: string;
  onSent: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [need, setNeed] = useState("");
  const [token, setToken] = useState("");
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/leads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schoolSlug: slug,
        contact: { name, email, phone },
        statedNeed: need,
        offeringId,
        turnstileToken: token,
        landingSessionToken: readLandingSessionToken(slug),
      }),
    });
    if (response.ok) onSent();
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-2 rounded-xl bg-page-50 p-3">
      <p>
        No matching trial time is open. Leave your details and the school will
        follow up.
      </p>
      <input
        required
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Name"
        className="rounded-md border border-page-300 px-3 py-2"
      />
      <input
        required
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="Email"
        className="rounded-md border border-page-300 px-3 py-2"
      />
      <input
        required
        value={phone}
        onChange={(event) => setPhone(event.target.value)}
        placeholder="Phone"
        className="rounded-md border border-page-300 px-3 py-2"
      />
      <textarea
        value={need}
        onChange={(event) => setNeed(event.target.value)}
        placeholder="What are you looking for?"
        className="rounded-md border border-page-300 px-3 py-2"
      />
      {siteKey ? <Turnstile siteKey={siteKey} onSuccess={setToken} /> : null}
      <button
        type="submit"
        disabled={!token}
        className="h-10 rounded-full bg-page-900 text-white disabled:opacity-40"
      >
        Contact me
      </button>
    </form>
  );
}
