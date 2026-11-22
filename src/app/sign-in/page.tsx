import { redirect } from "next/navigation";
import { ContinueWithGoogle } from "@/components/continue-with-google";
import { getCurrentUser } from "@/lib/auth/current-user";
import { PasswordForm } from "./password-form";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const signup = (await searchParams).mode === "signup";
  const user = await getCurrentUser();
  if (user) redirect("/");

  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">
        {signup ? "Create an account" : "Sign in"}
      </h1>
      <p className="text-sm text-page-400">Use your school owner email or continue with Google.</p>
      <PasswordForm key={String(signup)} signup={signup} />
      <ContinueWithGoogle />
    </main>
  );
}
