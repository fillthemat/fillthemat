import { headers } from "next/headers";
import { Suspense } from "react";
import { PageHeader } from "@/components/dashboard/page-header";
import { requireSchool } from "@/lib/auth/current-school";
import { OverviewBody } from "./overview/overview-body";
import { OverviewSkeleton } from "./overview/overview-skeleton";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ school }, params, headerList] = await Promise.all([
    requireSchool(),
    searchParams,
    headers(),
  ]);

  return (
    <main id="main-content" className="flex flex-col gap-6">
      <PageHeader title="Overview" />
      <Suspense fallback={<OverviewSkeleton />}>
        <OverviewBody school={school} errorParam={params.error} headerList={headerList} />
      </Suspense>
    </main>
  );
}
