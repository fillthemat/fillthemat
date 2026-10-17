import Link from "next/link";
import type { School } from "@/db/schema";
import { formatOwnerDateTime } from "@/components/dashboard/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { publicSchoolUrl } from "@/lib/site-url";
import { markPreviewedAction, publishSchoolAction } from "../actions";
import { sectionHref } from "../settings/sections";
import { formatBookingConversion, formatCountLabel } from "./format";
import { loadOverviewMetrics } from "./queries";

export async function OverviewBody({
  school,
  errorParam,
  headerList,
}: {
  school: School;
  errorParam?: string;
  headerList: Headers;
}) {
  const metrics = await loadOverviewMetrics(school.id);
  const published = school.publishedAt != null;
  const publicUrl = published ? publicSchoolUrl(school.slug, headerList) : null;
  const conversion = formatBookingConversion(metrics.convertedSessions, metrics.eligibleSessions);
  const blockers = unpublishedBlockers({
    approved: school.approvedAt != null,
    previewed: school.previewedAt != null,
    hasName: Boolean(school.name),
    hasSlug: Boolean(school.slug),
    hasTimezone: Boolean(school.timezone),
    hasNotificationEmail: Boolean(school.notificationEmail),
    hasLocation: Boolean(school.city || school.address),
    hasOffering: metrics.activeTrialClasses > 0,
    hasWindow: metrics.activeClassTimes > 0,
  });
  const emptyPublished =
    published &&
    metrics.upcomingBookings === 0 &&
    metrics.leads === 0 &&
    metrics.eligibleSessions === 0;

  return (
    <div className="flex flex-col gap-6">
      {errorParam === "not_ready" ? (
        <p role="status" className="text-sm text-destructive">
          Publishing needs approval, a completed preview, location and contact details, and at least
          one active trial class and class time.
        </p>
      ) : null}

      <section className="flex flex-col gap-3" aria-labelledby="publication">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 id="publication" className="text-sm font-medium">
              Public page
            </h2>
            <Badge variant={published ? "success" : "muted"}>
              {published ? "Published" : "Unpublished"}
            </Badge>
            {school.approvedAt ? null : <Badge variant="warning">Awaiting approval</Badge>}
          </div>
          <div className="flex flex-wrap gap-2">
            {publicUrl ? (
              <Button asChild variant="outline">
                <a href={publicUrl}>View Page</a>
              </Button>
            ) : null}
            <form action={markPreviewedAction}>
              <Button type="submit" variant={published ? "outline" : "secondary"}>
                Preview
              </Button>
            </form>
            {published ? null : (
              <form action={publishSchoolAction}>
                <Button type="submit">Publish</Button>
              </form>
            )}
          </div>
        </div>
        {publicUrl ? (
          <p className="text-sm">
            <a href={publicUrl} className="break-all underline-offset-4 hover:underline">
              {publicUrl}
            </a>
          </p>
        ) : null}
        {!published && blockers.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
            {blockers.map((item) => (
              <li key={item.id}>
                {item.href ? (
                  <Link href={item.href} className="underline-offset-4 hover:underline">
                    {item.label}
                  </Link>
                ) : (
                  item.label
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section aria-label="Summary">
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="grid grid-cols-1 md:grid-cols-3 md:divide-x md:divide-border">
            <MetricCell
              label="Upcoming bookings"
              value={String(metrics.upcomingBookings)}
              evidence="Scheduled from now"
              action={
                <Link
                  href="/dashboard/bookings?filter=upcoming&status=booked"
                  className="text-sm underline-offset-4 hover:underline"
                >
                  View bookings
                </Link>
              }
            />
            <MetricCell
              label="Leads"
              value={String(metrics.leads)}
              evidence="All time"
              action={
                <Link
                  href="/dashboard/leads"
                  className="text-sm underline-offset-4 hover:underline"
                >
                  View leads
                </Link>
              }
            />
            <MetricCell
              label="Booking conversion"
              value={conversion.value}
              evidence={conversion.evidence}
            />
          </div>
        </div>
        {emptyPublished ? (
          <p className="mt-3 text-sm text-pretty text-muted-foreground">
            No public-page activity yet.{" "}
            {publicUrl ? (
              <a href={publicUrl} className="underline-offset-4 hover:underline">
                View your public page
              </a>
            ) : null}
          </p>
        ) : null}
        {!published && metrics.upcomingBookings === 0 && metrics.leads === 0 ? (
          <p className="mt-3 text-sm text-pretty text-muted-foreground">
            Counts stay at zero until families use your public page.
          </p>
        ) : null}
      </section>

      <details className="text-sm">
        <summary className="cursor-pointer text-sm font-medium">
          Booking activity and definitions
        </summary>
        <div className="mt-3 flex flex-col gap-4">
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Detail
              label="Eligible sessions"
              value={metrics.eligibleSessions}
              hint="Public-page sessions with tracking that started on an approved, published page. Preview and known-bot sessions are excluded when the session is created. This does not mean every bot is eliminated, and these are not booking-ready prospects."
            />
            <Detail
              label="Converted sessions"
              value={metrics.convertedSessions}
              hint="Eligible sessions that made at least one booking. A later cancellation does not undo that a booking was made. Each session counts once."
            />
            <Detail
              label="Chat-assisted bookings"
              value={metrics.chatAssistedBookingEvents}
              hint="Recorded booking-confirmation events with source = chat. These are event counts, not the same as converted sessions."
            />
            <Detail
              label="Active trial classes"
              value={metrics.activeTrialClasses}
              hint="Configuration count, not traffic."
              action={
                <Link
                  href={sectionHref("offerings")}
                  className="text-sm underline-offset-4 hover:underline"
                >
                  Trial classes
                </Link>
              }
            />
            <Detail
              label="Active class times"
              value={metrics.activeClassTimes}
              hint="Configuration count, not traffic."
              action={
                <Link
                  href={sectionHref("schedule")}
                  className="text-sm underline-offset-4 hover:underline"
                >
                  Schedule
                </Link>
              }
            />
          </dl>
        </div>
      </details>

      {metrics.failedEmails > 0 ? (
        <p role="status" className="text-sm text-warning">
          {metrics.failedEmails === 1
            ? "1 email failed to send."
            : `${metrics.failedEmails} emails failed to send.`}
        </p>
      ) : null}

      <details className="text-sm text-muted-foreground">
        <summary className="cursor-pointer text-sm font-medium text-foreground">
          System status
          {metrics.failedEmails > 0 ? (
            <span className="ml-2 font-normal text-warning">
              {formatCountLabel(metrics.failedEmails, "email failure")}
            </span>
          ) : null}
        </summary>
        <dl className="mt-3 grid gap-2">
          <Detail label="Email failures" value={metrics.failedEmails} />
          <Detail
            label="Last maintenance"
            value={
              metrics.lastMaintenanceAt
                ? formatOwnerDateTime(metrics.lastMaintenanceAt, school.timezone)
                : "Never"
            }
          />
        </dl>
      </details>
    </div>
  );
}

function MetricCell({
  label,
  value,
  evidence,
  action,
}: {
  label: string;
  value: string;
  evidence: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 p-4 md:p-5">
      <p className="text-sm text-foreground">{label}</p>
      <p className="text-(length:--text-metric) leading-none font-semibold tabular-nums md:text-(length:--text-metric-lg)">
        {value}
      </p>
      <p className="text-xs leading-relaxed text-pretty text-muted-foreground md:text-sm">
        {evidence}
      </p>
      {action ? <div>{action}</div> : null}
    </div>
  );
}

function Detail({
  label,
  value,
  hint,
  action,
}: {
  label: string;
  value: string | number;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">
        {value}
        {hint ? (
          <p className="mt-1 text-xs font-normal text-pretty text-muted-foreground">{hint}</p>
        ) : null}
        {action ? <p className="mt-1">{action}</p> : null}
      </dd>
    </div>
  );
}

type ReadinessItem = {
  id: string;
  label: string;
  href?: string;
};

function unpublishedBlockers({
  approved,
  previewed,
  hasName,
  hasSlug,
  hasTimezone,
  hasNotificationEmail,
  hasLocation,
  hasOffering,
  hasWindow,
}: {
  approved: boolean;
  previewed: boolean;
  hasName: boolean;
  hasSlug: boolean;
  hasTimezone: boolean;
  hasNotificationEmail: boolean;
  hasLocation: boolean;
  hasOffering: boolean;
  hasWindow: boolean;
}): ReadinessItem[] {
  const items: ReadinessItem[] = [];
  if (!approved) {
    items.push({ id: "approval", label: "Awaiting approval" });
  }
  if (!previewed) {
    items.push({ id: "preview", label: "Preview the public page" });
  }
  if (!hasName) {
    items.push({
      id: "name",
      label: "Add a school name",
      href: sectionHref("profile"),
    });
  }
  if (!hasSlug) {
    items.push({
      id: "slug",
      label: "Add a public page address",
      href: sectionHref("profile"),
    });
  }
  if (!hasTimezone) {
    items.push({
      id: "timezone",
      label: "Choose a time zone",
      href: sectionHref("profile"),
    });
  }
  if (!hasNotificationEmail) {
    items.push({
      id: "email",
      label: "Add a notification email",
      href: sectionHref("profile"),
    });
  }
  if (!hasLocation) {
    items.push({
      id: "location",
      label: "Add a city or street address",
      href: sectionHref("profile"),
    });
  }
  if (!hasOffering) {
    items.push({
      id: "offering",
      label: "Add an active trial class",
      href: sectionHref("offerings"),
    });
  }
  if (!hasWindow) {
    items.push({
      id: "window",
      label: "Add an active class time",
      href: sectionHref("schedule"),
    });
  }
  return items;
}
