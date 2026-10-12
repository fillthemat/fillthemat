import { PageHeader } from "@/components/dashboard/page-header";
import { requireOwnedSchool } from "@/lib/auth/current-school";
import { domainCheckMessage } from "@/lib/poppy/domain-check-messages";
import { listSchoolDomains } from "@/lib/poppy/domains";
import { listTimezones } from "@/lib/timezones";
import { serializeTimestamp } from "./form-utils";
import { formatTimezone } from "./format";
import { loadFaqs, loadOfferings, loadWindows } from "./queries";
import { resolveSection, type SectionId, sectionMeta } from "./sections";
import { AgentSection } from "./sections/agent-section";
import { BrandingSection } from "./sections/branding-section";
import { FaqsSection } from "./sections/faqs-section";
import { OfferingsSection } from "./sections/offerings-section";
import { PoppySection } from "./sections/poppy-section";
import { PricingSection } from "./sections/pricing-section";
import { ProfileSection } from "./sections/profile-section";
import { ScheduleSection } from "./sections/schedule-section";
import { SettingsShell } from "./settings-shell";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const [{ school }, params] = await Promise.all([
    requireOwnedSchool(),
    searchParams,
  ]);
  const section: SectionId = resolveSection(params.section);
  const meta = sectionMeta(section);
  const location =
    [school.address, school.city].filter(Boolean).join(", ") || null;

  return (
    <main id="main-content" className="flex max-w-6xl flex-col gap-5">
      <PageHeader title="Settings" />

      <SettingsShell activeSection={section}>
        <section
          className="flex flex-col gap-5"
          aria-labelledby="section-title"
        >
          <h2 id="section-title" className="text-lg font-semibold">
            {meta.title}
          </h2>
          <SectionContent
            section={section}
            schoolId={school.id}
            school={school}
            location={location}
          />
        </section>
      </SettingsShell>
    </main>
  );
}

async function SectionContent({
  section,
  schoolId,
  school,
  location,
}: {
  section: SectionId;
  schoolId: string;
  school: Awaited<ReturnType<typeof requireOwnedSchool>>["school"];
  location: string | null;
}) {
  if (section === "profile") {
    const published = school.publishedAt != null;
    return (
      <ProfileSection
        published={published}
        timezones={published ? [] : listTimezones()}
        initialValues={{
          name: school.name,
          slug: school.slug,
          timezone: school.timezone,
          notificationEmail: school.notificationEmail,
          phone: school.phone ?? "",
          website: school.website ?? "",
          address: school.address ?? "",
          city: school.city ?? "",
          country: school.country,
          parkingNotes: school.parkingNotes ?? "",
          accessNotes: school.accessNotes ?? "",
          trialGuidance: school.trialGuidance ?? "",
        }}
      />
    );
  }

  if (section === "poppy") {
    const domains = await listSchoolDomains(schoolId);
    return (
      <PoppySection
        domains={domains.map((domain) => ({
          domain: domain.domain,
          state: domain.state,
          mode: domain.mode,
          sourceUrl: domain.sourceUrl,
          discoveryUrl: domain.discoveryUrl,
          downloadUrl: `data:application/json;base64,${Buffer.from(domain.document).toString("base64")}`,
          lastCheckMessage: domain.lastCheckResult
            ? domainCheckMessage(domain.lastCheckResult)
            : null,
          lastCheckedAt: domain.lastCheckedAt?.toISOString() ?? null,
        }))}
      />
    );
  }

  if (section === "offerings") {
    const [offerings, windows] = await Promise.all([
      loadOfferings(schoolId),
      loadWindows(schoolId),
    ]);
    return (
      <OfferingsSection
        offerings={offerings.map((offering) => ({
          id: offering.id,
          name: offering.name,
          description: offering.description,
          minimumAge: offering.minimumAge,
          maximumAge: offering.maximumAge,
          attire: offering.attire,
          expectations: offering.expectations,
          active: offering.active,
          updatedAt: serializeTimestamp(offering.updatedAt),
          windowCount: windows.filter(
            (window) => window.trialOfferingId === offering.id,
          ).length,
          activeWindowCount: windows.filter(
            (window) => window.trialOfferingId === offering.id && window.active,
          ).length,
        }))}
      />
    );
  }

  if (section === "schedule") {
    const [offerings, windows] = await Promise.all([
      loadOfferings(schoolId),
      loadWindows(schoolId),
    ]);
    return (
      <ScheduleSection
        timezoneLabel={formatTimezone(school.timezone)}
        offerings={offerings.map((offering) => ({
          id: offering.id,
          name: offering.name,
          active: offering.active,
        }))}
        windows={windows.map((window) => ({
          id: window.id,
          offeringName: window.offeringName,
          offeringActive: window.offeringActive,
          dayOfWeek: window.dayOfWeek,
          startMinute: window.startMinute,
          durationMinutes: window.durationMinutes,
          capacity: window.capacity,
          label: window.label,
          active: window.active,
          onCalendar: window.onCalendar,
          hasUpcomingBooking: window.hasUpcomingBooking,
          maxUpcomingBooked: window.maxUpcomingBooked,
        }))}
      />
    );
  }

  if (section === "pricing") {
    return <PricingSection pricing={school.pricing ?? ""} />;
  }

  if (section === "faqs") {
    const faqRows = await loadFaqs(schoolId);
    return (
      <FaqsSection
        faqs={faqRows.map((faq) => ({
          id: faq.id,
          question: faq.question,
          answer: faq.answer,
          updatedAt: serializeTimestamp(faq.updatedAt),
        }))}
      />
    );
  }

  if (section === "agent") {
    return (
      <AgentSection
        welcomeMessage={school.welcomeMessage ?? ""}
        agentInstructions={school.agentInstructions ?? ""}
        schoolName={school.name}
        location={location}
        logoUrl={school.logoUrl}
        primaryColor={school.primaryColor}
      />
    );
  }

  return (
    <BrandingSection
      logoUrl={school.logoUrl ?? ""}
      primaryColor={school.primaryColor ?? ""}
      schoolName={school.name}
      location={location}
      welcomeMessage={school.welcomeMessage ?? ""}
    />
  );
}
