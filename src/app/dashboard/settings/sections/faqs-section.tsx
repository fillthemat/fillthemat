"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { SettingsFormState } from "../form-state";
import { createFaqAction, deleteFaqAction, updateFaqAction } from "../actions";
import { LIMITS } from "../schemas";
import { Callout, EmptyState, FieldGroup } from "../ui/controls";
import { DiscardEditsDialog, useRecordEditor, useTimedAnnouncement } from "../ui/editor-lifecycle";
import { FaqFields } from "../ui/faq-fields";
import { ItemActionForm, SaveBar, type SaveSuccessMeta, useSettingsForm } from "../ui/section-form";

export type FaqItem = {
  id: string;
  question: string;
  answer: string;
  updatedAt: string;
};

const STARTER_QUESTIONS = [
  "Do we need a uniform for the first class?",
  "Can a parent stay and watch?",
  "What happens if we need to reschedule?",
  "Is there a make-up class if we miss one?",
];

export function FaqsSection({ faqs }: { faqs: FaqItem[] }) {
  const editor = useRecordEditor("faqs");
  const [announcement, setAnnouncement] = useTimedAnnouncement();
  const [focusId, setFocusId] = useState<string | null>(null);
  const addRef = useRef<HTMLDivElement>(null);
  const [createQuestion, setCreateQuestion] = useState("");
  const atLimit = faqs.length >= LIMITS.faqCount;

  const openAdd = (question?: string) => {
    setAnnouncement(null);
    setCreateQuestion(question ?? "");
    editor.requestOpen({ type: "create" });
  };

  useEffect(() => {
    if (!editor.isCreating) return;
    requestAnimationFrame(() => {
      const selector = createQuestion ? "textarea" : "input";
      addRef.current?.querySelector<HTMLElement>(selector)?.focus();
    });
  }, [editor.isCreating, createQuestion]);

  const onCreateSuccess = (state: SettingsFormState, meta: SaveSuccessMeta) => {
    if (state.message) setAnnouncement(state.message);
    if (meta.preservedEdits) return;
    const id = state.values?.id;
    editor.closeImmediate();
    if (id) setFocusId(id);
  };

  const onEditSuccess = (id: string, state: SettingsFormState, meta: SaveSuccessMeta) => {
    if (state.message) setAnnouncement(state.message);
    if (meta.preservedEdits) return;
    editor.closeImmediate();
    setFocusId(id);
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
              <FaqRow
                key={faq.id}
                faq={faq}
                editing={editor.isEditing(faq.id)}
                categorySaving={editor.saving}
                onEdit={() => {
                  setAnnouncement(null);
                  editor.requestOpen({ type: "edit", id: faq.id });
                }}
                onIdleClose={editor.closeImmediate}
                onDirtyClose={() => editor.requestCancel(true)}
                onSuccess={(state, meta) => onEditSuccess(faq.id, state, meta)}
                onPendingChange={editor.setSaving}
                editRef={(node) => {
                  if (node && focusId === faq.id) {
                    node.focus();
                    setFocusId(null);
                  }
                }}
              />
            ))}
          </ul>
        )}
      </section>

      {atLimit ? (
        <Callout tone="warning">
          You have reached the limit of {LIMITS.faqCount} questions. You can still edit the ones you
          have. Delete one to make room for another.
        </Callout>
      ) : editor.isCreating ? (
        <div ref={addRef}>
          <CreateFaqForm
            key={createQuestion || "blank"}
            initialQuestion={createQuestion}
            onIdleClose={editor.closeImmediate}
            onDirtyClose={() => editor.requestCancel(true)}
            onSuccess={onCreateSuccess}
            onPendingChange={editor.setSaving}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Button
            type="button"
            variant="outline"
            className="self-start"
            onClick={() => openAdd()}
            disabled={editor.saving}
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
                    onClick={() => openAdd(question)}
                    disabled={editor.saving}
                  >
                    {question}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <DiscardEditsDialog
        open={editor.pendingTarget !== null && !editor.saving}
        onKeepEditing={editor.keepEditing}
        onDiscard={editor.discardAndSwitch}
      />
    </div>
  );
}

function FaqRow({
  faq,
  editing,
  categorySaving,
  onEdit,
  onIdleClose,
  onDirtyClose,
  onSuccess,
  onPendingChange,
  editRef,
}: {
  faq: FaqItem;
  editing: boolean;
  categorySaving: boolean;
  onEdit: () => void;
  onIdleClose: () => void;
  onDirtyClose: () => void;
  onSuccess: (state: SettingsFormState, meta: SaveSuccessMeta) => void;
  onPendingChange: (pending: boolean) => void;
  editRef: (node: HTMLButtonElement | null) => void;
}) {
  return (
    <li id={`faq-${faq.id}`} className="flex flex-col gap-3 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <h4 className="min-w-0 text-sm font-medium text-pretty">{faq.question}</h4>
        <div className="flex flex-wrap items-start gap-2 sm:justify-end">
          <Button
            ref={editRef}
            type="button"
            variant="outline"
            size="sm"
            onClick={onEdit}
            disabled={categorySaving}
            aria-expanded={editing}
            aria-controls={editing ? `faq-editor-${faq.id}` : undefined}
          >
            Edit
          </Button>
          <ItemActionForm
            action={deleteFaqAction}
            id={faq.id}
            label="Delete"
            pendingLabel="Deleting…"
            variant="danger"
            disabled={editing && categorySaving}
            className="items-end"
            confirm={{
              title: "Delete this question?",
              body: <>Your agent will stop using this answer. Deleting cannot be undone.</>,
              confirmLabel: "Delete Question",
            }}
          />
        </div>
      </div>
      {editing ? (
        <EditFaqForm
          faq={faq}
          onIdleClose={onIdleClose}
          onDirtyClose={onDirtyClose}
          onSuccess={onSuccess}
          onPendingChange={onPendingChange}
        />
      ) : (
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
      )}
    </li>
  );
}

function CreateFaqForm({
  initialQuestion = "",
  onIdleClose,
  onDirtyClose,
  onSuccess,
  onPendingChange,
}: {
  initialQuestion?: string;
  onIdleClose: () => void;
  onDirtyClose: () => void;
  onSuccess: (state: SettingsFormState, meta: SaveSuccessMeta) => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const { state, formAction, formRef, pending, values, setField, dirty, errorFor } =
    useSettingsForm({
      action: createFaqAction,
      initialValues: { question: initialQuestion, answer: "" },
      dirtyKey: "faqs:new",
      clearOnSuccess: true,
      onSuccess,
      onPendingChange,
    });

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-5">
      <FieldGroup title="Add a question">
        <FaqFields values={values} setField={setField} errorFor={errorFor} disabled={pending} />
      </FieldGroup>
      <SaveBar
        saveLabel="Add Question"
        savingLabel="Adding…"
        pending={pending}
        dirty={dirty}
        onCancel={onIdleClose}
        onCancelDirty={onDirtyClose}
        state={state}
        idleHint="Your agent can use a new answer as soon as it is added."
      />
    </form>
  );
}

function EditFaqForm({
  faq,
  onIdleClose,
  onDirtyClose,
  onSuccess,
  onPendingChange,
}: {
  faq: FaqItem;
  onIdleClose: () => void;
  onDirtyClose: () => void;
  onSuccess: (state: SettingsFormState, meta: SaveSuccessMeta) => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const { state, formAction, formRef, pending, values, setField, dirty, errorFor } =
    useSettingsForm({
      action: updateFaqAction,
      initialValues: {
        question: faq.question,
        answer: faq.answer,
        updatedAt: faq.updatedAt,
      },
      dirtyKey: `faqs:edit:${faq.id}`,
      onSuccess,
      onPendingChange,
    });

  return (
    <form
      id={`faq-editor-${faq.id}`}
      ref={formRef}
      action={formAction}
      className="flex flex-col gap-5 rounded-md border border-border p-4"
    >
      <input type="hidden" name="id" value={faq.id} />
      <input type="hidden" name="updatedAt" value={values.updatedAt} />
      <FieldGroup title="Edit question">
        <FaqFields values={values} setField={setField} errorFor={errorFor} disabled={pending} />
      </FieldGroup>
      <SaveBar
        saveLabel="Save Changes"
        savingLabel="Saving…"
        pending={pending}
        dirty={dirty}
        onCancel={onIdleClose}
        onCancelDirty={onDirtyClose}
        state={state}
        idleHint="Saved changes are used by your agent right away."
      />
    </form>
  );
}
