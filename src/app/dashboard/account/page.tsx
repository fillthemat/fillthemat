import { redirect } from "next/navigation";
import { ContinueWithGoogle } from "@/components/continue-with-google";
import { PageHeader } from "@/components/dashboard/page-header";
import { createClient } from "@/lib/supabase/server";
import { SetPassword } from "./set-password";

export default async function AccountPage() {
  const { auth } = await createClient();
  const {
    data: { user },
    error,
  } = await auth.getUser();
  if (error) throw error;
  if (!user) redirect("/sign-in");
  const linked = user.identities?.some((identity) => identity.provider === "google");
  return (
    <main id="main-content" className="flex max-w-md flex-col gap-6">
      <PageHeader title="Account" />
      <p>Signed in as {user.email}</p>
      <SetPassword />
      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Google</h2>
        {linked ? (
          <p>Google account linked.</p>
        ) : (
          <ContinueWithGoogle linkAccount next="/dashboard/account" />
        )}
      </section>
    </main>
  );
}
