import { redirect } from "next/navigation";
import { ContinueWithGoogle } from "@/components/continue-with-google";
import { DevEmailAuth } from "@/components/dev-email-auth";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isDevEmailAuthEnabled } from "@/lib/dev-flags";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");

  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
      <p className="text-sm text-page-400">
        School owners sign in with Google. Prospects never need an account.
      </p>
      {isDevEmailAuthEnabled() ? <DevEmailAuth /> : null}
      <ContinueWithGoogle />
    </main>
  );
}
