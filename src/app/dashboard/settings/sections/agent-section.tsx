"use client";

import { Button } from "@/components/ui/button";
import { FieldGroup as UiFieldGroup } from "@/components/ui/field";
import { updateAgentAction } from "../actions";
import { agentSchema, LIMITS } from "../schemas";
import { Callout, FieldGroup, TextAreaField } from "../ui/controls";
import { PreviewPanel } from "../ui/preview-panel";
import { PublicPagePreview } from "../ui/public-page-preview";
import { SaveBar, useSettingsForm } from "../ui/settings-form";

const EXAMPLE_INSTRUCTIONS = `Sound warm and encouraging, and keep answers short.
Call students by their first name once you know it.
Before booking, ask whether the student has any previous martial arts experience.
Ask whether there are injuries or conditions our instructors should know about.
Mention that parents are welcome to watch from the benches.`;

export function AgentSection({
  welcomeMessage,
  agentInstructions,
  schoolName,
  location,
  logoUrl,
  primaryColor,
}: {
  welcomeMessage: string;
  agentInstructions: string;
  schoolName: string;
  location: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
}) {
  const { state, onSubmit, pending, control, values, setField, dirty, reset } = useSettingsForm({
    action: updateAgentAction,
    initialValues: { welcomeMessage, agentInstructions },
    schema: agentSchema,
  });

  return (
    <div className="grid gap-6 xl:grid-cols-(--settings-page-columns)">
      <form noValidate onSubmit={onSubmit} className="flex min-w-0 flex-col gap-5">
        <UiFieldGroup>
          <TextAreaField
            label="Welcome message"
            name="welcomeMessage"
            rows={4}
            maxLength={LIMITS.welcomeMessage}
            control={control}
            helper="Leave blank to use a simple default greeting."
            placeholder="Hi! I can answer questions about our kids and adult classes and help you book a free trial…"
          />
        </UiFieldGroup>

        <FieldGroup title="Tone and qualification questions">
          <TextAreaField
            label="Instructions for your agent"
            name="agentInstructions"
            rows={8}
            maxLength={LIMITS.agentInstructions}
            control={control}
            helper="Tone and extra questions only. Facts belong in the other categories."
            placeholder="Sound warm and encouraging, and keep answers short…"
          />
          {(values.agentInstructions ?? "").trim().length === 0 ? (
            <div className="flex flex-col items-start gap-2">
              <p className="text-sm font-medium">Example</p>
              <pre className="max-w-full overflow-x-auto text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
                {EXAMPLE_INSTRUCTIONS}
              </pre>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setField("agentInstructions", EXAMPLE_INSTRUCTIONS)}
              >
                Start From This Example
              </Button>
            </div>
          ) : null}
        </FieldGroup>

        <Callout title="Fixed for every school">
          <ul className="list-disc pl-5">
            <li>Answers only from these settings.</li>
            <li>Never invents prices or discounts.</li>
            <li>Eligibility comes from trial-class age ranges.</li>
            <li>Only offers real open class times — never holds a spot.</li>
            <li>Never takes payment, handles waivers, or confirms a booking.</li>
          </ul>
        </Callout>

        <SaveBar
          saveLabel="Save Agent Settings"
          pending={pending}
          dirty={dirty}
          onDiscard={reset}
          state={state}
          idleHint="Saved changes apply to the next conversation a family starts."
        />
      </form>

      <PreviewPanel
        title="Welcome preview"
        dirty={dirty}
        note="Representative view of your booking page. It shows your welcome message, not what your agent will answer next."
      >
        <PublicPagePreview
          schoolName={schoolName}
          location={location}
          logoUrl={logoUrl ?? undefined}
          accentColor={primaryColor ?? undefined}
          welcomeMessage={values.welcomeMessage ?? ""}
        />
      </PreviewPanel>
    </div>
  );
}
