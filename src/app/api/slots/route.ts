import { isAgeEligible, listOpenSlots } from "@/lib/schedule/occurrences";
import { getSchoolForLandingAccess, loadSchoolCatalog } from "@/lib/schools/public";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug");
  const offeringId = url.searchParams.get("offeringId");
  const ageValue = url.searchParams.get("age");
  if (!slug || !offeringId) {
    return Response.json({ error: "invalid" }, { status: 400 });
  }
  const school = await getSchoolForLandingAccess(slug, {
    preview: url.searchParams.get("preview") === "1",
  });
  if (!school) return Response.json({ error: "not_found" }, { status: 404 });
  const catalog = await loadSchoolCatalog(school.id);
  const offering = catalog.offerings.find((row) => row.id === offeringId && row.active);
  if (!offering) return Response.json({ slots: [], noMatch: true });
  const age = ageValue == null ? null : Number(ageValue);
  if (age != null && !isAgeEligible(age, offering)) {
    return Response.json({ slots: [], noMatch: true, reason: "ineligible" });
  }
  const slots = listOpenSlots({
    offeringId,
    timezone: school.timezone,
    windows: catalog.windows,
    occurrences: catalog.occurrences,
    now: new Date(),
  });
  return Response.json({
    slots,
    noMatch: slots.length === 0,
  });
}
