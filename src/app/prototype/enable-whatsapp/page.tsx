import { Suspense } from "react";
import { SettingsShell } from "@/app/dashboard/settings/settings-shell";
import { WhatsAppPrototype } from "@/app/dashboard/settings/whatsapp-prototype";
import { DashboardNav } from "@/components/dashboard/nav";
import { PageHeader } from "@/components/dashboard/page-header";

// Public, fixture-only mirror of the authenticated settings section. No auth
// bypass, database reads, server actions, or vendor calls; DO NOT MERGE.
export default function WhatsAppPrototypePage() {
  return (
    <div className="dashboard flex min-h-dvh flex-col md:flex-row">
      <DashboardNav schoolName="Northside Martial Arts · demo" />
      <div className="min-w-0 flex-1 p-4 md:p-6">
        <main id="main-content" className="flex max-w-6xl flex-col gap-5">
          <PageHeader title="Settings" />
          <SettingsShell activeSection="whatsapp">
            <section
              className="flex flex-col gap-5"
              aria-labelledby="section-title"
            >
              <h2 id="section-title" className="text-lg font-semibold">
                WhatsApp
              </h2>
              <Suspense fallback={<p>Loading throwaway prototype…</p>}>
                <WhatsAppPrototype
                  school={{
                    name: "Northside Martial Arts",
                    slug: "northside",
                    approved: true,
                    published: true,
                    phone: "+1 (202) 555-0100",
                    notificationEmail: "owner@example.com",
                  }}
                  demo
                />
              </Suspense>
            </section>
          </SettingsShell>
        </main>
      </div>
    </div>
  );
}
