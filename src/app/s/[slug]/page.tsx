import { notFound } from "next/navigation";
import { BookingChat } from "@/components/booking-chat";
import { LandingSession } from "@/components/landing-session";
import { getSchoolForLandingAccess, loadSchoolCatalog } from "@/lib/schools/public";

export default async function PublicSchoolPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ preview?: string }>;
}) {
  const { slug } = await params;
  const { preview } = await searchParams;
  const isPreview = preview === "1";
  const school = await getSchoolForLandingAccess(slug, { preview: isPreview });
  if (!school) notFound();

  const published = school.approvedAt != null && school.publishedAt != null;

  const catalog = await loadSchoolCatalog(school.id);
  const location = [school.address, school.city].filter(Boolean).join(", ") || null;

  return (
    <main className="mx-auto flex min-h-full w-full max-w-lg flex-col gap-6 px-4 py-8">
      <LandingSession slug={school.slug} preview={isPreview || !published} />
      {school.logoUrl ? (
        <img src={school.logoUrl} alt={`${school.name} logo`} className="h-12 w-auto" />
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
      />
    </main>
  );
}
