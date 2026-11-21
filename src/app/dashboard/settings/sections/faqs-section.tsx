"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SettingsFormState } from "../form-state";
import { createFaqAction, deleteFaqAction, updateFaqAction } from "../actions";
import { faqSchema, LIMITS } from "../schemas";
import { Callout, EmptyState, FieldGroup } from "../ui/controls";
import { FaqFields } from "../ui/faq-fields";
import { ItemActionForm, SaveBar, useSettingsForm } from "../ui/settings-form";
import { useTimedAnnouncement } from "../ui/use-timed-announcement";

export type FaqItem = { id: string; question: string; answer: string; updatedAt: string };

const STARTER_QUESTIONS = [
  "Do we need a uniform for the first class?",
  "Can a parent stay and watch?",
  "What happens if we need to reschedule?",
  "Is there a make-up class if we miss one?",
];

export function FaqsSection({ faqs }: { faqs: FaqItem[] }) {
  const [editor, setEditor] = useState<{ faq?: FaqItem; question?: string } | null>(null);
  const [announcement, setAnnouncement] = useTimedAnnouncement();
  const opener = useRef<HTMLButtonElement | null>(null);
  const savedId = useRef<string | undefined>(undefined);
  const atLimit = faqs.length >= LIMITS.faqCount;
  const open = (button: HTMLButtonElement, target: NonNullable<typeof editor>) => {
    opener.current = button;
    savedId.current = undefined;
    setAnnouncement(null);
    setEditor(target);
  };
  return (
    <div className="flex flex-col gap-6">
      {announcement ? (
        <p role="status" aria-live="polite" className="text-sm text-success">
          {announcement}
        </p>
      ) : null}
      <section className="flex flex-col gap-3" aria-labelledby="faq-list">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="faq-list" className="text-sm font-semibold">
            Your questions
          </h3>
          <p className="text-xs text-muted-foreground tabular-nums">
            {faqs.length} of {LIMITS.faqCount} used
          </p>
        </div>
        {faqs.length === 0 ? (
          <EmptyState title="No questions yet">
            Without FAQs your agent still answers from school details, trial classes, schedule, and
            pricing.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {faqs.map((faq) => (
              <li key={faq.id} id={`faq-${faq.id}`} className="flex flex-col gap-3 py-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <h4 className="min-w-0 text-sm font-medium text-pretty">{faq.question}</h4>
                  <div className="flex flex-wrap items-start gap-2 sm:justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={(event) => open(event.currentTarget, { faq })}
                    >
                      Edit
                    </Button>
                    <ItemActionForm
                      action={deleteFaqAction}
                      id={faq.id}
                      label="Delete"
                      pendingLabel="Deleting…"
                      variant="danger"
                      className="items-end"
                      confirm={{
                        title: "Delete this question?",
                        body: (
                          <>Your agent will stop using this answer. Deleting cannot be undone.</>
                        ),
                        confirmLabel: "Delete Question",
                      }}
                    />
                  </div>
                </div>
                <details className="group">
                  <summary className="flex cursor-pointer touch-manipulation list-none items-center gap-3 rounded-md text-sm">
                    <span aria-hidden="true" className="text-xs text-muted-foreground">
                      <span className="group-open:hidden">Show answer</span>
                      <span className="hidden group-open:inline">Hide answer</span>
                    </span>
                  </summary>
                  <p className="mt-2 max-w-prose text-sm leading-relaxed wrap-break-word whitespace-pre-wrap text-muted-foreground">
                    {faq.answer}
                  </p>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
      {atLimit ? (
        <Callout tone="warning">
          You have reached the limit of {LIMITS.faqCount} questions. You can still edit the ones you
          have. Delete one to make room for another.
        </Callout>
      ) : (
        <div className="flex flex-col gap-3">
          <Button
            type="button"
            variant="outline"
            className="self-start"
            onClick={(event) => open(event.currentTarget, {})}
          >
            Add a Question
          </Button>
          <div className="flex flex-col gap-1">
            <p className="text-xs text-muted-foreground">Starting points:</p>
            <ul className="flex flex-wrap gap-x-3 gap-y-1">
              {STARTER_QUESTIONS.map((question) => (
                <li key={question}>
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto text-left whitespace-normal"
                    onClick={(event) => open(event.currentTarget, { question })}
                  >
                    {question}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      <Dialog
        open={editor !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setEditor(null);
        }}
      >
        <DialogContent
          className="max-h-[90dvh] overflow-y-auto"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const saved = savedId.current
              ? document
                  .getElementById(`faq-${savedId.current}`)
                  ?.querySelector<HTMLButtonElement>("button")
              : null;
            (saved ?? opener.current)?.focus();
          }}
          onOpenAutoFocus={(event) => {
            if (editor?.question && event.currentTarget instanceof HTMLElement) {
              event.preventDefault();
              event.currentTarget.querySelector("textarea")?.focus();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{editor?.faq ? "Edit question" : "Add a question"}</DialogTitle>
            <DialogDescription>Saved changes are used by your agent right away.</DialogDescription>
          </DialogHeader>
          {editor ? (
            <FaqForm
              faq={editor.faq}
              question={editor.question}
              onCancel={() => setEditor(null)}
              onSuccess={(state) => {
                setAnnouncement(state.message);
                savedId.current = editor.faq?.id ?? state.values?.id;
                setEditor(null);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FaqForm({
  faq,
  question = "",
  onCancel,
  onSuccess,
}: {
  faq?: FaqItem;
  question?: string;
  onCancel: () => void;
  onSuccess: (state: SettingsFormState) => void;
}) {
  const { state, onSubmit, pending, control, dirty } = useSettingsForm({
    action: faq ? updateFaqAction : createFaqAction,
    schema: faqSchema,
    initialValues: faq
      ? { id: faq.id, updatedAt: faq.updatedAt, question: faq.question, answer: faq.answer }
      : { question, answer: "" },
    onSuccess,
  });
  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
      <FieldGroup>
        <FaqFields control={control} disabled={pending} />
      </FieldGroup>
      <SaveBar
        saveLabel={faq ? "Save Changes" : "Add Question"}
        savingLabel={faq ? "Saving…" : "Adding…"}
        pending={pending}
        dirty={dirty}
        onCancel={onCancel}
        state={state}
        idleHint={
          faq
            ? "Saved changes are used by your agent right away."
            : "Your agent can use a new answer as soon as it is added."
        }
      />
    </form>
  );
}
