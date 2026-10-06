"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { BookingFlow } from "./booking-flow";
import { randomToken, readConversationToken } from "./browser-token";

type Offering = {
  id: string;
  name: string;
  description: string | null;
  minimumAge: number | null;
  maximumAge: number | null;
  active: boolean;
};

type DebugSession = { resumeToken: string; debugContext: string };

export function BookingChat(props: {
  slug: string;
  schoolName: string;
  location: string | null;
  offerings: Offering[];
  welcomeMessage: string | null;
  preview?: boolean;
  debugAvailable?: boolean;
}) {
  const { slug, debugAvailable } = props;
  const [debugSession, setDebugSession] = useState<DebugSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [debugError, setDebugError] = useState<string | null>(null);
  const [previousTimeline, setPreviousTimeline] = useState<string | null>(null);
  const storageKey = `fillthemat.debug.${slug}`;
  const previousKey = `fillthemat.debug.previous.${slug}`;
  useEffect(() => {
    setDebugSession(null);
    setPreviousTimeline(null);
    if (!debugAvailable) return;
    try {
      const previous = sessionStorage.getItem(previousKey);
      if (
        previous &&
        /^https:\/\/[^/]+\.langfuse\.com\/project\//.test(previous)
      )
        setPreviousTimeline(previous);
      const stored = sessionStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as DebugSession;
        if (parsed.resumeToken?.startsWith("dbg_") && parsed.debugContext)
          setDebugSession(parsed);
      }
    } catch {
      sessionStorage.removeItem(storageKey);
    }
  }, [debugAvailable, storageKey, previousKey]);

  const startTest = async () => {
    if (busy) return;
    setDebugError(null);
    const resumeToken = `dbg_${randomToken()}`;
    try {
      if (debugSession) {
        const previous = await fetch(
          `/api/chat/debug?slug=${encodeURIComponent(slug)}`,
          {
            headers: {
              "x-debug-context": debugSession.debugContext,
              "x-debug-resume-token": debugSession.resumeToken,
            },
          },
        );
        if (previous.ok) {
          const { sessionUrl } = (await previous.json()) as {
            sessionUrl: string | null;
          };
          if (sessionUrl) {
            setPreviousTimeline(sessionUrl);
            sessionStorage.setItem(previousKey, sessionUrl);
          }
        }
      }
      const response = await fetch("/api/chat/debug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, resumeToken }),
      });
      if (!response.ok) throw new Error("Could not start a fresh debug test.");
      const { debugContext } = (await response.json()) as {
        debugContext: string;
      };
      const session = { resumeToken, debugContext };
      sessionStorage.setItem(storageKey, JSON.stringify(session));
      setDebugSession(session);
    } catch {
      setDebugError(
        "Could not start a debug test. Check your owner access and server configuration.",
      );
    }
  };
  const openTimeline = async () => {
    if (!debugSession) return;
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    try {
      const response = await fetch(
        `/api/chat/debug?slug=${encodeURIComponent(slug)}`,
        {
          headers: {
            "x-debug-context": debugSession.debugContext,
            "x-debug-resume-token": debugSession.resumeToken,
          },
        },
      );
      if (!response.ok) throw new Error("access_expired");
      const { sessionUrl } = (await response.json()) as {
        sessionUrl: string | null;
      };
      if (!sessionUrl) throw new Error("timeline_unavailable");
      if (tab) tab.location.replace(sessionUrl);
      else
        setDebugError(
          "Allow pop-ups for this site to open the Langfuse timeline.",
        );
    } catch {
      tab?.close();
      setDebugError(
        "Timeline unavailable. Send a message first or start a new test if access expired.",
      );
    }
  };

  return (
    <div className="space-y-4">
      {debugAvailable ? (
        <section className="rounded-xl border border-page-300 p-4 text-sm">
          <p className="font-medium">
            Conversation debugger · synthetic data only
          </p>
          <p className="text-page-600">
            Prompts, messages, and tool results in debug tests are sent to
            Langfuse. Do not enter real participant details.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void startTest()}
              className="rounded-full border border-page-300 px-3 py-2 disabled:opacity-50"
            >
              {debugSession ? "New test" : "Start debug conversation"}
            </button>
            {debugSession ? (
              <button
                type="button"
                onClick={() => void openTimeline()}
                className="rounded-full border border-page-300 px-3 py-2"
              >
                Open conversation timeline
              </button>
            ) : null}
            {previousTimeline ? (
              <a
                href={previousTimeline}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border border-page-300 px-3 py-2"
              >
                Previous timeline
              </a>
            ) : null}
          </div>
          {debugError ? (
            <p role="alert" className="mt-2 text-page-error">
              {debugError}
            </p>
          ) : null}
        </section>
      ) : null}
      <ChatSession
        key={debugSession?.resumeToken ?? "public"}
        {...props}
        debugSession={debugSession}
        onBusyChange={setBusy}
      />
    </div>
  );
}

function ChatSession({
  slug,
  schoolName,
  location,
  offerings,
  welcomeMessage,
  preview = false,
  debugSession,
  onBusyChange,
}: {
  slug: string;
  schoolName: string;
  location: string | null;
  offerings: Offering[];
  welcomeMessage: string | null;
  preview?: boolean;
  debugSession: DebugSession | null;
  onBusyChange: (busy: boolean) => void;
}) {
  const [resumeToken, setResumeToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRequestId, setLastRequestId] = useState<string | null>(null);
  const [hydrating, setHydrating] = useState(true);
  const hydratedIds = useRef(new Set<string>());
  const [prepared, setPrepared] = useState<{
    offeringId: string;
    slotId: string;
    offeringName: string;
    whenLabel: string;
  } | null>(null);
  const [showBook, setShowBook] = useState(false);

  useEffect(() => {
    setResumeToken(debugSession?.resumeToken ?? readConversationToken(slug));
  }, [slug, debugSession]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        fetch: debugSession
          ? async (input, init) => {
              const response = await fetch(input, init);
              const id = response.headers.get("x-chat-request-id");
              if (id && /^[0-9a-f-]{36}$/i.test(id)) setLastRequestId(id);
              return response;
            }
          : undefined,
        prepareSendMessagesRequest: ({ messages }) => ({
          body: {
            slug,
            preview,
            resumeToken:
              debugSession?.resumeToken ?? readConversationToken(slug),
            debugContext: debugSession?.debugContext,
            message: messages.at(-1),
          },
        }),
      }),
    [slug, preview, debugSession],
  );

  const { messages, sendMessage, status, setMessages, clearError } = useChat({
    transport,
    onError: () =>
      setError(
        "Chat failed. Your message was not automatically retried; check the timeline or try a new message.",
      ),
  });
  useEffect(() => {
    onBusyChange(status === "streaming" || status === "submitted" || hydrating);
  }, [status, hydrating, onBusyChange]);

  useEffect(() => {
    if (!resumeToken) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(
          debugSession
            ? `/api/chat?slug=${encodeURIComponent(slug)}${preview ? "&preview=1" : ""}`
            : `/api/chat?slug=${encodeURIComponent(slug)}&resumeToken=${encodeURIComponent(resumeToken)}${preview ? "&preview=1" : ""}`,
          debugSession
            ? {
                headers: {
                  "x-debug-resume-token": resumeToken,
                  "x-debug-context": debugSession.debugContext,
                },
              }
            : undefined,
        );
        if (!response.ok) throw new Error("history_unavailable");
        const payload = (await response.json()) as { messages: UIMessage[] };
        if (!cancelled) {
          hydratedIds.current = new Set(
            payload.messages.map((message) => message.id),
          );
          setMessages(payload.messages);
        }
      } catch {
        if (!cancelled)
          setError("History unavailable. Refresh or start a new test.");
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resumeToken, slug, preview, setMessages, debugSession]);

  useEffect(() => {
    for (const message of messages) {
      if (hydratedIds.current.has(message.id)) continue;
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
      {error ? (
        <p role="alert" className="text-sm text-page-error">
          {error}
          {debugSession && lastRequestId ? ` Request ${lastRequestId}.` : ""}
        </p>
      ) : null}
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
            if (
              !text ||
              hydrating ||
              (status !== "ready" && status !== "error")
            )
              return;
            if (status === "error") clearError();
            setLastRequestId(null);
            setError(null);
            void sendMessage({ text });
            input.value = "";
          }}
        >
          <input
            name="message"
            placeholder="Ask about classes or times"
            className="flex-1 rounded-full border border-page-300 px-4 py-2 text-sm"
            disabled={hydrating || (status !== "ready" && status !== "error")}
          />
          <button
            type="submit"
            className="rounded-full bg-page-950 px-4 text-sm text-white disabled:opacity-50"
            disabled={hydrating || (status !== "ready" && status !== "error")}
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
