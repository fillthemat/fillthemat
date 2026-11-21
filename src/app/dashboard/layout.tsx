import { DashboardNav } from "@/components/dashboard/nav";
import { requireSchool } from "@/lib/auth/current-school";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { school } = await requireSchool();

  return (
    <div className="dashboard flex min-h-dvh flex-col md:flex-row">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-3 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <DashboardNav schoolName={school.name} />
      <div className="flex min-h-dvh min-w-0 flex-1 flex-col p-4 md:p-6">{children}</div>
    </div>
  );
}
