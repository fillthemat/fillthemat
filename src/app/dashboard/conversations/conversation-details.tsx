import type { Conversation } from "@/db/schema";

export function ChannelLabel({
  channel,
}: {
  channel: Conversation["channel"];
}) {
  return <span>{channel === "whatsapp" ? "WhatsApp" : "Web chat"}</span>;
}

export function ContactDetails({
  contact,
}: {
  contact: { name: string; email: string | null; phone: string } | null;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="font-medium text-pretty">
        {contact?.name ?? "Unknown contact"}
      </p>
      {contact ? (
        <p className="text-sm text-muted-foreground break-words">
          {[contact.email, contact.phone].filter(Boolean).join(" · ")}
        </p>
      ) : null}
    </div>
  );
}
