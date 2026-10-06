import { notFound } from "next/navigation";
import { BookingChat } from "@/components/booking-chat";
import { LandingSession } from "@/components/landing-session";
import { getOwnedSchool } from "@/lib/auth/current-school";
import { getVerifiedClaims } from "@/lib/auth/current-user";
import { isLocalAiStub } from "@/lib/dev-flags";
import { debugOwner } from "@/lib/observability/debug-context";
import { getSchoolBySlug, loadSchoolCatalog } from "@/lib/schools/public";

export default async function PublicSchoolPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ preview?: string }>;
}) {
  const { slug } = await params;
  const { preview } = await searchParams;
  const school = await getSchoolBySlug(slug);
  if (!school) notFound();

  const isPreview = preview === "1";
  const published = school.approvedAt != null && school.publishedAt != null;
  if (!published) {
    if (!isPreview) notFound();
    const user = await getVerifiedClaims();
    const owned = user ? await getOwnedSchool(user.id) : null;
    if (!owned || owned.id !== school.id) notFound();
  }

  const catalog = await loadSchoolCatalog(school.id);
  const location =
    [school.address, school.city].filter(Boolean).join(", ") || null;

  return (
    <main className="mx-auto flex min-h-full w-full max-w-lg flex-col gap-6 px-4 py-8">
      <LandingSession slug={school.slug} preview={isPreview || !published} />
      {school.logoUrl ? (
        // biome-ignore lint/performance/noImgElement: tenant logos are arbitrary HTTPS URLs
        <img
          src={school.logoUrl}
          alt={`${school.name} logo`}
          className="h-12 w-auto"
        />
      ) : null}
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{school.name}</h1>
        {location ? <p className="text-page-600">{location}</p> : null}
      </div>
      <BookingChat
        slug={school.slug}
        schoolName={school.name}
        location={location}
        offerings={catalog.offerings}
        welcomeMessage={school.welcomeMessage}
        preview={isPreview || !published}
        debugAvailable={
          isPreview && !isLocalAiStub() && Boolean(await debugOwner(school))
        }
      />
    </main>
  );
}
