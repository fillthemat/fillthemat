import type { WhatsAppConnectionState } from "@/db/schema";

/** Share only an allocated, Live number; wa.me requires digits without '+'. */
export function whatsappShareLink(connection: {
  state: WhatsAppConnectionState;
  number: string | null;
}): string | null {
  return connection.state === "live" &&
    /^\+1\d{10}$/.test(connection.number ?? "")
    ? `https://wa.me/${connection.number?.slice(1)}`
    : null;
}
