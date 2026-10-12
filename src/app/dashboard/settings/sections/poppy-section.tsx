"use client";

import { useActionState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IDLE_STATE, type SettingsFormState } from "../form-state";
import {
  checkPoppyDomainAction,
  connectPoppyDomainAction,
  removePoppyDomainAction,
} from "../poppy-actions";
import { Callout, TextField } from "../ui/controls";
import { SaveBar, useSettingsForm } from "../ui/section-form";

type DomainView = {
  domain: string;
  state: "pending" | "verified" | "failing";
  mode: "redirect" | "copy";
  sourceUrl: string;
  discoveryUrl: string;
  downloadUrl: string;
  lastCheckMessage: string | null;
  lastCheckedAt: string | null;
};

function DomainAction({
  domain,
  action,
  label,
}: {
  domain: string;
  action: (
    prev: SettingsFormState,
    data: FormData,
  ) => Promise<SettingsFormState>;
  label: string;
}) {
  const [state, dispatch, pending] = useActionState(action, IDLE_STATE);
  return (
    <form action={dispatch} className="flex flex-col items-start gap-2">
      <input type="hidden" name="domain" value={domain} />
      <Button
        type="submit"
        variant="outline"
        size="sm"
        disabled={pending}
        aria-label={`${label}: ${domain}`}
      >
        {pending ? "Working…" : label}
      </Button>
      <p role="status" className="text-sm text-muted-foreground">
        {state.message}
      </p>
    </form>
  );
}

export function PoppySection({ domains }: { domains: DomainView[] }) {
  const {
    state,
    formAction,
    formRef,
    pending,
    values,
    setField,
    dirty,
    reset,
    errorFor,
  } = useSettingsForm({
    action: connectPoppyDomainAction,
    initialValues: { domain: "" },
    dirtyKey: "poppy:domain",
    clearOnSuccess: true,
  });
  const on = domains.some((domain) => domain.state !== "pending");
  return (
    <div className="flex flex-col gap-5">
      <Callout>
        Poppy lets a prospect's own AI (a Personal Agent) find your School
        through your website. You need a domain you control and can redirect
        from, or host a JSON file on. Schools without such a domain are not
        discoverable yet. Adding a domain does not turn Poppy on until its check
        passes.
      </Callout>
      <p className="text-sm font-medium">
        Poppy is {on ? "on" : "off"} for your School.
      </p>
      <form ref={formRef} action={formAction} className="flex flex-col gap-5">
        <TextField
          label="Website domain"
          name="domain"
          value={values.domain ?? ""}
          onValueChange={(value) => setField("domain", value)}
          placeholder="school.example"
          maxLength={260}
          required
          spellCheck={false}
          helper="Enter only the domain, without https:// or a path. The www. form is covered too."
          error={errorFor("domain")}
        />
        <SaveBar
          saveLabel="Add Domain"
          pending={pending}
          dirty={dirty}
          onDiscard={reset}
          state={state}
        />
      </form>
      {domains.map((domain) => (
        <section
          key={domain.domain}
          className="flex min-w-0 flex-col gap-3 rounded-lg border p-4"
          aria-label={`Domain ${domain.domain}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">{domain.domain}</h3>
            <Badge variant="muted">{domain.state}</Badge>
            <span className="text-sm text-muted-foreground">
              {domain.mode} mode
            </span>
          </div>
          <p className="text-sm">
            Set an HTTPS redirect (301, 302, 307 or 308):
          </p>
          <dl className="text-sm">
            <dt className="font-medium">From</dt>
            <dd className="break-all">{domain.sourceUrl}</dd>
            <dt className="mt-2 font-medium">To</dt>
            <dd className="break-all">{domain.discoveryUrl}</dd>
          </dl>
          <p className="text-sm text-muted-foreground">
            If your website builder cannot redirect, host the downloaded file at
            the From URL with Content-Type: application/json. Do not edit or
            reformat it. Configure the same redirect or copy for www.
            {domain.domain}.
          </p>
          <div className="flex flex-wrap items-start gap-3">
            <Button asChild variant="outline" size="sm">
              <a href={domain.downloadUrl} download="poppy.json">
                Download poppy.json
              </a>
            </Button>
            <DomainAction
              domain={domain.domain}
              action={checkPoppyDomainAction}
              label="Check now"
            />
            <DomainAction
              domain={domain.domain}
              action={removePoppyDomainAction}
              label="Remove domain"
            />
          </div>
          {domain.lastCheckMessage ? (
            <p className="text-sm text-muted-foreground">
              {domain.lastCheckMessage}{" "}
              {domain.lastCheckedAt ? (
                <time dateTime={domain.lastCheckedAt}>
                  Checked {domain.lastCheckedAt}
                </time>
              ) : null}
            </p>
          ) : null}
        </section>
      ))}
    </div>
  );
}
