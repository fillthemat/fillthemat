"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useState } from "react";
import { BookingFlow } from "./booking-flow";
import { readConversationToken } from "./browser-token";

type Offering = {
  id: string;
  name: string;
  description: string | null;
  minimumAge: number | null;
  maximumAge: number | null;
  active: boolean;
};

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
  const [prepared, setPrepared] = useState<{
    offeringId: string;
    slotId: string;
    offeringName: string;
    whenLabel: string;
  } | null>(null);
  const [showBook, setShowBook] = useState(false);

  useEffect(() => {
    setResumeToken(readConversationToken(slug));
  }, [slug]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
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

  const { messages, sendMessage, status, setMessages } = useChat({
    transport,
  });

  useEffect(() => {
    if (!resumeToken) return;
    void (async () => {
      const response = await fetch(
        `/api/chat?slug=${encodeURIComponent(slug)}&resumeToken=${encodeURIComponent(resumeToken)}${preview ? "&preview=1" : ""}`,
      );
      if (!response.ok) return;
      const payload = (await response.json()) as { messages: UIMessage[] };
      // History is reloaded from the server on refresh via GET; useChat starts empty
      // and the first send continues the server-canonical transcript.
      setMessages(payload.messages);
      void payload;
    })();
  }, [resumeToken, slug, preview, setMessages]);

  useEffect(() => {
    for (const message of messages) {
      for (const part of message.parts) {
        if (
          part.type === "tool-prepare_booking" &&
          "state" in part &&
          part.state === "output-available" &&
          "output" in part
        ) {
          const output = part.output as {
            ok?: boolean;
            offering?: { id: string; name: string };
            slot?: {
              slotId: string;
              localDateLabel: string;
              localTimeLabel: string;
            };
          };
          if (output.ok && output.offering && output.slot) {
            setPrepared({
              offeringId: output.offering.id,
              slotId: output.slot.slotId,
              offeringName: output.offering.name,
              whenLabel: `${output.slot.localDateLabel} at ${output.slot.localTimeLabel}`,
            });
            setShowBook(true);
          }
        }
      }
    }
  }, [messages]);

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
        onClick={() => setShowBook(true)}
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
          prepared={prepared}
          preview={preview}
        />
      ) : null}
    </div>
  );
}
