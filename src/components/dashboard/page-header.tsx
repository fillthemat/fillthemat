export function PageHeader({ title }: { title: string }) {
  return (
    <h1 className="text-page-title leading-tight font-semibold tracking-tight md:text-2xl">
      {title}
    </h1>
  );
}
