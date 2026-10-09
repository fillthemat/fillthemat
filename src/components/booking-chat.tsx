"use client";

import { useChat } from "@ai-sdk/react";
import { APICallError, DefaultChatTransport } from "ai";
import { useEffect, useMemo, useState } from "react";
import type { AssistantUIMessage } from "@/lib/ai/assistant";
import { BookingFlow, type ProposedTrial } from "./booking-flow";
import { readConversationToken } from "./browser-token";

type Offering = {
  id: string;
  name: string;
  description: string | null;
  minimumAge: number | null;
  maximumAge: number | null;
  active: boolean;
};

function isMessageLimitRefusal(error: Error | undefined): boolean {
  if (!APICallError.isInstance(error) || error.statusCode !== 429) return false;
  try {
    return JSON.parse(error.responseBody ?? "{}").error === "limit";
  } catch {
    return false;
  }
}

// The trial offering and slot of the assistant's last Booking Intent, handed
// to Book Trial.
function lastProposedTrial(
  messages: AssistantUIMessage[],
): ProposedTrial | null {
  let proposedTrial: ProposedTrial | null = null;
  for (const message of messages) {
    for (const part of message.parts) {
      if (
        part.type === "tool-prepare_booking" &&
        part.state === "output-available" &&
        part.output.ok
      ) {
        const { offering, slot } = part.output;
        proposedTrial = {
          offeringId: offering.id,
          slotId: slot.slotId,
          offeringName: offering.name,
          whenLabel: `${slot.localDateLabel} at ${slot.localTimeLabel}`,
        };
      }
    }
  }
  return proposedTrial;
}

export function BookingChat({
  slug,
  schoolName,
  location,
  offerings,
  welcomeMessage,
  preview = false,
}: {
  slug: string;
  schoolName: string;
  location: string | null;
  offerings: Offering[];
  welcomeMessage: string | null;
  preview?: boolean;
}) {
  const [resumeToken, setResumeToken] = useState<string | null>(null);
  const [bookRequested, setBookRequested] = useState(false);

  useEffect(() => {
    setResumeToken(readConversationToken(slug));
  }, [slug]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<AssistantUIMessage>({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages }) => ({
          body: {
            slug,
            preview,
            resumeToken: readConversationToken(slug),
            message: messages.at(-1),
          },
        }),
      }),
    [slug, preview],
  );

  const { messages, sendMessage, status, setMessages, error } = useChat({
    transport,
  });

  useEffect(() => {
    if (!resumeToken) return;
    void (async () => {
      const response = await fetch(
        `/api/chat?slug=${encodeURIComponent(slug)}&resumeToken=${encodeURIComponent(resumeToken)}${preview ? "&preview=1" : ""}`,
      );
      if (!response.ok) return;
      const payload = (await response.json()) as {
        messages: AssistantUIMessage[];
      };
      // History is reloaded from the server on refresh via GET; useChat starts empty
      // and the first send continues the server-canonical transcript.
      setMessages(payload.messages);
      void payload;
    })();
  }, [resumeToken, slug, preview, setMessages]);

  const messageLimitReached = isMessageLimitRefusal(error);
  const proposedTrial = messageLimitReached
    ? null
    : lastProposedTrial(messages);
  const showBook = bookRequested || proposedTrial !== null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex min-h-80 flex-col rounded-2xl border border-page-200 bg-white">
        <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
          {welcomeMessage ? (
            <p className="text-page-600">{welcomeMessage}</p>
          ) : null}
          {messages.map((message) => (
            <div
              key={message.id}
              className={message.role === "user" ? "text-right" : ""}
            >
              {message.parts.some((part) => part.type === "text") ? (
                <p>
                  {message.parts
                    .filter((part) => part.type === "text")
                    .map((part) => part.text)
                    .join("")}
                </p>
              ) : null}
            </div>
          ))}
          {status === "streaming" ? <p className="text-page-400">…</p> : null}
          {messageLimitReached ? (
            <p
              role="status"
              className="rounded-xl bg-page-50 p-3 text-page-600"
            >
              This conversation has reached its message limit. Your next message
              starts a fresh conversation.
            </p>
          ) : null}
        </div>
        <form
          className="flex gap-2 border-t border-page-100 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const input = form.elements.namedItem(
              "message",
            ) as HTMLInputElement;
            const text = input.value.trim();
            if (!text) return;
            // The server ended this conversation. Keep its notice visible until
            // the next send, then show only the fresh conversation's messages.
            if (messageLimitReached) setMessages([]);
            void sendMessage({ text });
            input.value = "";
          }}
        >
          <input
            name="message"
            placeholder="Ask about classes or times"
            className="flex-1 rounded-full border border-page-300 px-4 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded-full bg-page-950 px-4 text-sm text-white"
          >
            Send
          </button>
        </form>
      </div>
      <button
        type="button"
        onClick={() => setBookRequested(true)}
        className="h-12 rounded-full bg-page-950 text-white"
      >
        Book Trial
      </button>
      {showBook ? (
        <BookingFlow
          slug={slug}
          schoolName={schoolName}
          location={location}
          offerings={offerings}
          proposedTrial={proposedTrial}
          preview={preview}
        />
      ) : null}
    </div>
  );
}
