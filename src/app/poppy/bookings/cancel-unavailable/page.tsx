export default function CancelUnavailablePage() {
  return (
    <main className="mx-auto max-w-lg space-y-6 px-6 py-16">
      <h1 className="text-2xl font-semibold">Cancel link unavailable</h1>
      <p>
        This link is invalid, has already been used, or the trial can no longer
        be cancelled. Contact the school using the details in your confirmation
        email.
      </p>
    </main>
  );
}
