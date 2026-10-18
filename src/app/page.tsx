import { redirect } from "next/navigation";
import { ContinueWithGoogle } from "@/components/continue-with-google";
import { getOwnedSchool } from "@/lib/auth/current-school";
import { getCurrentUser } from "@/lib/auth/current-user";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; next?: string }>;
}) {
  const params = await searchParams;
  if (params.code) {
    const callback = new URLSearchParams();
    callback.set("code", params.code);
    if (params.next) callback.set("next", params.next);
    redirect(`/auth/callback?${callback.toString()}`);
  }

  const user = await getCurrentUser();
  if (user) {
    const school = await getOwnedSchool(user.id);
    redirect(school ? "/dashboard" : "/onboarding");
  }

  return (
    <main className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center gap-8 px-6 py-16">
      <p className="text-sm tracking-eyebrow text-page-500 uppercase">Fillthemat</p>
      <h1 className="text-4xl font-semibold tracking-tight">
        Turn martial arts interest into booked trial classes.
      </h1>
      <p className="max-w-xl text-lg text-page-400">
        Give every school a branded AI concierge and a persistent Book Trial path. Prospects confirm
        a timeslot. You see who is coming.
      </p>
      <ContinueWithGoogle />
    </main>
  );
}
