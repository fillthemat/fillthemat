import { redirect } from "next/navigation";
import { getOwnedSchool } from "@/lib/auth/current-school";
import { requireUser } from "@/lib/auth/current-user";
import { listTimezones } from "@/lib/timezones";
import { createSchoolAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser();
  const school = await getOwnedSchool(user.id);
  if (school) redirect("/dashboard");
  const params = await searchParams;
  const timezones = listTimezones();

  return (
    <main className="mx-auto flex min-h-full w-full max-w-lg flex-col gap-6 px-6 py-16">
      <h1 className="text-3xl font-semibold">Create your school</h1>
      <p className="text-sm text-page-400">
        This creates an unpublished school. Publishing happens after approval and a completed
        preview.
      </p>
      {params.error ? (
        <p className="text-sm text-destructive">
          {params.error === "slug" ? "That public URL is taken." : "Check the form and try again."}
        </p>
      ) : null}
      <form action={createSchoolAction} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          School name
          <input
            name="name"
            required
            maxLength={80}
            className="rounded-md border border-page-700 bg-transparent px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Public URL slug
          <input
            name="slug"
            required
            minLength={3}
            maxLength={48}
            placeholder="tiger-dojo"
            className="rounded-md border border-page-700 bg-transparent px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Timezone
          <select
            name="timezone"
            defaultValue="America/New_York"
            className="rounded-md border border-page-700 bg-transparent px-3 py-2"
          >
            {timezones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          City
          <input
            name="city"
            maxLength={80}
            className="rounded-md border border-page-700 bg-transparent px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Notification email
          <input
            name="notificationEmail"
            type="email"
            required
            defaultValue={user.email}
            className="rounded-md border border-page-700 bg-transparent px-3 py-2"
          />
        </label>
        <button
          type="submit"
          className="h-11 rounded-full bg-foreground text-sm font-medium text-background"
        >
          Continue
        </button>
      </form>
    </main>
  );
}
