import Link from "next/link";

export default function AuthErrorPage() {
  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center gap-4 px-6 py-16">
      <h1 className="text-2xl font-semibold">Could not sign in</h1>
      <p className="text-sm text-page-400">
        The sign-in link expired or the request was cancelled. Try again from the sign-in page.
      </p>
      <Link href="/sign-in" className="text-sm underline">
        Back to sign in
      </Link>
    </main>
  );
}
